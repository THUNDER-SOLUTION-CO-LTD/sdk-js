/** Rate limit counters from the `X-RateLimit-*` response headers. */
export interface RateLimit {
    /** Requests allowed in the current window. */
    readonly limit: number
    /** Requests left in the current window. */
    readonly remaining: number
    /** When the window resets, as the API sends it (Unix seconds). */
    readonly reset: number
}

/** Response details that are not part of the returned data. */
export interface ResponseMeta {
    /** HTTP status code. */
    readonly status: number
    /** `x-request-id` header, else `cf-ray`, else null. Quote it when you contact support. */
    readonly requestId: string | null
    /** The v2 envelope `message`, when the API sent one. */
    readonly message: string | null
    /** Rate limit counters, when the API sent all three headers. */
    readonly rateLimit: RateLimit | null
    /** Response headers with lower-case names. */
    readonly headers: Readonly<Record<string, string>>
}

/** A returned value with its response details on the non-enumerable `meta` property. */
export type WithMeta<T> = T & { readonly meta: ResponseMeta }

/** Attaches `meta` without making it part of the value's JSON or its enumerable keys. */
export function attachMeta<T extends object>(value: T, meta: ResponseMeta): WithMeta<T> {
    Object.defineProperty(value, 'meta', { value: meta, enumerable: false })
    return value as WithMeta<T>
}

export function headersToRecord(headers: Headers | Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    if (headers instanceof Headers) {
        headers.forEach((value, key) => {
            out[key.toLowerCase()] = value
        })
        return out
    }
    for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value
    return out
}

export function requestIdFrom(headers: Readonly<Record<string, string>>): string | null {
    return headers['x-request-id'] || headers['cf-ray'] || null
}

function toInt(value: string | undefined): number | null {
    if (value === undefined || !/^\s*-?\d+\s*$/.test(value)) return null
    return Number.parseInt(value, 10)
}

export function rateLimitFrom(headers: Readonly<Record<string, string>>): RateLimit | null {
    const limit = toInt(headers['x-ratelimit-limit'])
    const remaining = toInt(headers['x-ratelimit-remaining'])
    const reset = toInt(headers['x-ratelimit-reset'])
    if (limit === null || remaining === null || reset === null) return null
    return { limit, remaining, reset }
}

/** Seconds from a `Retry-After` header (delta seconds or HTTP date), or null. */
export function retryAfterFrom(
    headers: Readonly<Record<string, string>>,
    now: number = Date.now(),
): number | null {
    const raw = headers['retry-after']?.trim()
    if (!raw) return null
    if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10)
    const at = Date.parse(raw)
    if (Number.isNaN(at)) return null
    return Math.max(0, Math.ceil((at - now) / 1000))
}
