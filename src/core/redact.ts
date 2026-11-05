// Removes the configured API key from everything the SDK takes from a response or a transport
// error. The key is found by decoding, not by listing encodings.

/** What the SDK puts where it removed the API key or an Authorization value. */
export const REDACTED = '[REDACTED]'

const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization'])
const MAX_CAUSE_DEPTH = 3

/** Removes one API key. */
export interface Redactor {
    /**
     * Raw and percent-encoded spans of the key become `[REDACTED]`; if a decoded view
     * of the result still carries the key, the whole text becomes `[REDACTED]`.
     */
    text(value: string): string
    /** Whether the text or one of its decoded views contains the key. */
    carries(value: string): boolean
}

export const noRedact: Redactor = { text: (value) => value, carries: () => false }

const utf8 = new TextDecoder()

/** `%HH` (either hex case) becomes that byte; runs of bytes are read as UTF-8. */
export function percentDecode(text: string): string {
    if (!text.includes('%')) return text
    return text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
        const bytes = new Uint8Array(run.length / 3)
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Number.parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16)
        }
        return utf8.decode(bytes)
    })
}

const JSON_ESCAPES: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
}

/** JSON string unescaping: `\uXXXX` (either hex case) and the short escapes. */
export function jsonUnescape(text: string): string {
    if (!text.includes('\\')) return text
    return text.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, seq: string) =>
        seq.length === 5
            ? String.fromCharCode(Number.parseInt(seq.slice(1), 16))
            : (JSON_ESCAPES[seq] as string),
    )
}

/** Matches the key with any subset of its characters percent-encoded, in either hex case. */
function percentPattern(apiKey: string): RegExp {
    const hex = (byte: number) =>
        [...byte.toString(16).padStart(2, '0')]
            .map((d) => (/[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d))
            .join('')
    const parts = [...apiKey].map((char) => {
        const literal = char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
        const encoded = [...new TextEncoder().encode(char)].map((b) => `%${hex(b)}`).join('')
        return `(?:${literal}|${encoded})`
    })
    return new RegExp(parts.join(''), 'g')
}

/** Builds the redactor for one API key. Keys shorter than 4 characters are left alone. */
export function redactor(apiKey: string): Redactor {
    if (apiKey.length < 4) return noRedact
    const pattern = percentPattern(apiKey)
    const carries = (value: string): boolean => {
        // The text, its percent-decoding, its JSON unescaping, and each applied to the other,
        // one level deep.
        let views = [value]
        const seen = new Set(views)
        for (let level = 0; level <= 3; level++) {
            if (views.some((view) => view.includes(apiKey))) return true
            const next: string[] = []
            for (const view of views) {
                for (const decoded of [percentDecode(view), jsonUnescape(view)]) {
                    if (!seen.has(decoded)) {
                        seen.add(decoded)
                        next.push(decoded)
                    }
                }
            }
            if (next.length === 0) return false
            views = next
        }
        return false
    }
    return {
        carries,
        text(value) {
            if (!value) return value
            const out = value.replace(pattern, REDACTED)
            return carries(out) ? REDACTED : out
        },
    }
}

/**
 * Authorization and Proxy-Authorization are always `[REDACTED]`; any other value that
 * carries the key becomes `[REDACTED]` as a whole.
 */
export function redactHeaders(
    headers: Readonly<Record<string, string>>,
    redact: Redactor,
): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [name, value] of Object.entries(headers)) {
        out[name] = AUTH_HEADERS.has(name.toLowerCase()) || redact.carries(value) ? REDACTED : value
    }
    return out
}

function defineValue(target: object, key: string, value: unknown) {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

/**
 * Applies `text` to every string of a parsed JSON value, object keys included. Returns the
 * same value when nothing changed.
 */
export function redactJson(value: unknown, redact: Redactor): unknown {
    if (typeof value === 'string') return redact.text(value)
    if (Array.isArray(value)) {
        const out = value.map((item) => redactJson(item, redact))
        return out.some((item, i) => item !== value[i]) ? out : value
    }
    if (value === null || typeof value !== 'object') return value
    let changed = false
    const out = {}
    for (const [key, item] of Object.entries(value)) {
        const safeKey = redact.text(key)
        const safeItem = redactJson(item, redact)
        if (safeKey !== key || safeItem !== item) changed = true
        // defineProperty, so a "__proto__" key stays a plain key
        defineValue(out, safeKey, safeItem)
    }
    return changed ? out : value
}

/**
 * Redaction of a whole body: `body` is `text` parsed as JSON (undefined when it is not JSON). Returns
 * the body that may be shown and the redacted parsed value.
 */
export function redactBody(
    text: string,
    body: unknown,
    redact: Redactor,
): { rawBody: string; body: unknown } {
    if (body === undefined) return { rawBody: redact.text(text), body }
    const safe = redactJson(body, redact)
    return { rawBody: safe === body ? text : JSON.stringify(safe), body: safe }
}

function read(source: unknown, key: string): unknown {
    try {
        return (source as Record<string, unknown>)[key]
    } catch {
        return undefined
    }
}

function typeName(source: unknown): string {
    if (source instanceof Error) return String(read(source, 'name') ?? 'Error')
    if (source === null) return 'null'
    if (typeof source !== 'object') return typeof source
    const ctor = read(source, 'constructor') as { name?: unknown } | undefined
    return typeof ctor?.name === 'string' && ctor.name ? ctor.name : 'Object'
}

function messageOf(source: unknown): string {
    if (typeof source === 'string') return source
    const message = read(source, 'message')
    if (typeof message === 'string') return message
    if (source instanceof Error || (source !== null && typeof source === 'object')) return ''
    return String(source)
}

/**
 * A sanitized copy of a transport failure. It holds the type name, the message after `text`,
 * `code` and `errno` when they are strings or numbers, and the sanitized copy of the
 * original's own cause (at most 3 levels). Never the original or any other property.
 */
export function sanitizeCause(cause: unknown, redact: Redactor, depth = 1): Error {
    const copy = new Error(redact.text(messageOf(cause)))
    copy.name = redact.text(typeName(cause))
    copy.stack = `${copy.name}: ${copy.message}`
    for (const field of ['code', 'errno']) {
        const value = cause !== null && typeof cause === 'object' ? read(cause, field) : undefined
        if (typeof value === 'string') defineValue(copy, field, redact.text(value))
        else if (typeof value === 'number') {
            defineValue(copy, field, redact.carries(String(value)) ? REDACTED : value)
        }
    }
    const inner = cause !== null && typeof cause === 'object' ? read(cause, 'cause') : undefined
    if (inner !== undefined && depth < MAX_CAUSE_DEPTH) {
        Object.defineProperty(copy, 'cause', {
            value: sanitizeCause(inner, redact, depth + 1),
            enumerable: false,
            writable: true,
            configurable: true,
        })
    }
    return copy
}
