import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { inspect } from 'node:util'
import * as sdk from '../../src/index.ts'
import { mockClient, v2error } from './helpers.ts'

// A fake key with "/", "+" and "=", echoed back in every key form and every
// place a server, proxy or custom transport can put it. The assertions decode with the helpers
// below, not with the SDK's own redaction code.
const KEY = 'sk_xy/Fake+Key=9z'
const REDACTED = '[REDACTED]'

const hex = (char: string, upper: boolean) => {
    const h = char.charCodeAt(0).toString(16).padStart(2, '0')
    return upper ? h.toUpperCase() : h
}
const u = (char: string, upper = false) => `\\u00${hex(char, upper)}`
const chars = [...KEY]

/** Every form of the key, as the server writes it into JSON text, plain text or a header. */
const FORMS: Record<string, string> = {
    raw: KEY,
    'percent upper hex': chars.map((c) => `%${hex(c, true)}`).join(''),
    'percent lower hex': chars.map((c) => `%${hex(c, false)}`).join(''),
    'percent subset, mixed case': chars
        .map((c, i) => (i % 2 ? `%${hex(c, i % 4 === 1)}` : c))
        .join(''),
    encodeURIComponent: encodeURIComponent(KEY),
    'unicode escape every char': chars.map((c) => u(c)).join(''),
    'unicode escape mixed with literals and \\/': chars
        .map((c, i) => (c === '/' ? '\\/' : i % 2 ? u(c) : c))
        .join(''),
    'unicode escape upper hex': chars.map((c) => u(c, true)).join(''),
}

// Test-side decoders: percent-decoding of ASCII bytes and JSON string unescaping.
const percent = (s: string) =>
    s.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
const unicode = (s: string) =>
    s
        .replace(/\\u([0-9a-f]{4})/gi, (_, h: string) =>
            String.fromCharCode(Number.parseInt(h, 16)),
        )
        .replace(/\\\//g, '/')

function jsonStrings(value: unknown, out: string[]) {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) for (const item of value) jsonStrings(item, out)
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            out.push(k)
            jsonStrings(v, out)
        }
    }
}

/** Whether the key can be read back from `text` by decoding it. */
function recoverable(text: string, depth = 0): boolean {
    if (text.includes(KEY)) return true
    if (depth >= 3) return false
    const candidates = new Set([percent(text), unicode(text)])
    for (const wrap of [text, `"${text}"`]) {
        try {
            const strings: string[] = []
            jsonStrings(JSON.parse(wrap), strings)
            for (const s of strings) candidates.add(s)
        } catch {}
    }
    candidates.delete(text)
    return [...candidates].some((c) => recoverable(c, depth + 1))
}

/** Every public surface of an error, its headers and its cause chain. */
function surfaces(error: unknown): Record<string, string> {
    const out: Record<string, string> = {}
    let current: unknown = error
    for (let level = 0; current !== undefined && level < 6; level++) {
        const e = current as Error & Record<string, unknown>
        const p = level ? `cause${level}.` : ''
        out[`${p}String`] = String(e)
        out[`${p}inspect`] = inspect(e, { depth: 10, showHidden: true })
        out[`${p}JSON`] = JSON.stringify(e) ?? ''
        out[`${p}message`] = String(e?.message)
        out[`${p}stack`] = String(e?.stack)
        if (e instanceof sdk.ApiError) {
            out.code = String(e.code)
            out.rawBody = e.rawBody
            out.details = JSON.stringify(e.details)
            out.toJSON = JSON.stringify(e.toJSON())
            for (const [name, value] of Object.entries(e.headers)) out[`header ${name}`] = value
        }
        current = e?.cause
    }
    return out
}

function expectNoKey(values: Record<string, string>) {
    const leaks = Object.entries(values)
        .filter(([, v]) => recoverable(v))
        .map(([k]) => k)
    expect(leaks).toEqual([])
}

// Loopback API: the next answer is set by the test before each call.
let server: Server
let base = ''
let next: { status: number; headers: Record<string, string>; body: string }

beforeAll(async () => {
    server = createServer((_req, res) => {
        res.writeHead(next.status, next.headers)
        res.end(next.body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
})

const client = () =>
    new sdk.Client({
        apiKey: KEY,
        v1BaseUrl: `${base}/v1`,
        v2BaseUrl: `${base}/v2`,
        maxRetries: 0,
    })
const JSON_TYPE = { 'content-type': 'application/json' }

async function failing(call: (c: sdk.Client) => Promise<unknown>): Promise<sdk.ApiError> {
    const error = await call(client()).then(
        () => undefined,
        (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(sdk.ApiError)
    return error as sdk.ApiError
}

describe('key forms echoed in responses', () => {
    for (const [form, value] of Object.entries(FORMS)) {
        describe(form, () => {
            test('v2 error.message and an object key', async () => {
                next = {
                    status: 400,
                    headers: JSON_TYPE,
                    body: `{"success":false,"error":{"code":"VALIDATION_ERROR","message":"bad auth Bearer ${value}"},"seen":{"${value}":1}}`,
                }
                const error = await failing((c) => c.getInfo())
                expect(error).toBeInstanceOf(sdk.InvalidRequestError)
                expectNoKey(surfaces(error))
                expect(error.message).toBe(`bad auth Bearer ${REDACTED}`)
                const shown = JSON.parse(error.rawBody)
                expect(shown.error.message).toBe(`bad auth Bearer ${REDACTED}`)
                expect(Object.keys(shown.seen)).toEqual([REDACTED])
                expect(error.sensitiveRawBody()).toBe(next.body)
            })

            test('v1 message and details', async () => {
                next = {
                    status: 400,
                    headers: JSON_TYPE,
                    body: `{"status":400,"message":"${value}","details":[{"field":"f ${value}","message":"m ${value}"}]}`,
                }
                const error = await failing((c) => c.v1.getMe())
                expectNoKey(surfaces(error))
                expect(error.code).toBe(REDACTED)
                expect(error.details).toEqual([
                    { field: `f ${REDACTED}`, message: `m ${REDACTED}` },
                ])
                expect(error.sensitiveRawBody()).toBe(next.body)
            })

            test('non-JSON error body', async () => {
                next = {
                    status: 502,
                    headers: { 'content-type': 'text/html' },
                    body: `<html>proxy saw Authorization: Bearer ${value}</html>`,
                }
                const error = await failing((c) => c.getInfo())
                expect(error).toBeInstanceOf(sdk.ServerError)
                expectNoKey(surfaces(error))
                expect([
                    `<html>proxy saw Authorization: Bearer ${REDACTED}</html>`,
                    REDACTED,
                ]).toContain(error.rawBody)
                expect(error.sensitiveRawBody()).toBe(next.body)
            })

            test('error response header', async () => {
                next = {
                    status: 404,
                    headers: { ...JSON_TYPE, 'x-echo': value, 'x-request-id': value },
                    body: '{"success":false,"error":{"code":"SLIP_NOT_FOUND","message":"no"}}',
                }
                const error = await failing((c) => c.verify.bankByPayload('P'))
                expectNoKey(surfaces(error))
                expect(error.headers['x-echo']).toBe(REDACTED)
                expect(error.requestId).toBe(REDACTED)
                expect(error.rawBody).toBe(next.body)
            })

            test('success response header and meta.message', async () => {
                next = {
                    status: 200,
                    headers: { ...JSON_TYPE, 'x-echo': value, authorization: `Bearer ${value}` },
                    body: `{"success":true,"data":{},"message":"hi ${value}"}`,
                }
                const info = await client().getInfo()
                const meta = { ...info.meta.headers, message: String(info.meta.message) }
                expectNoKey({ ...meta, JSON: JSON.stringify(info.meta) })
                expect(info.meta.headers['x-echo']).toBe(REDACTED)
                expect(info.meta.headers.authorization).toBe(REDACTED)
                expect(info.meta.message).toBe(`hi ${REDACTED}`)
            })
        })
    }

    test('a body without the key stays byte-identical', async () => {
        next = {
            status: 404,
            headers: { ...JSON_TYPE, 'x-echo': 'harmless %41 \\u0041' },
            body: '{ "success" : false, "error" : { "code" : "SLIP_NOT_FOUND", "message" : "no \\u00e9" } }',
        }
        const error = await failing((c) => c.verify.bankByPayload('P'))
        expect(error.rawBody).toBe(next.body)
        expect(error.message).toBe('no é')
        expect(error.headers['x-echo']).toBe('harmless %41 \\u0041')
    })
})

describe('key in transport failures', () => {
    const throwing = (thrown: unknown) =>
        new sdk.Client({
            apiKey: KEY,
            v2BaseUrl: 'https://api.test/v2',
            maxRetries: 0,
            fetch: async () => {
                throw thrown
            },
        })
    const cases: Array<[string, () => unknown]> = [
        ['message carries the key', () => new TypeError(`fetch failed for Bearer ${KEY}`)],
        [
            'message carries an escaped key',
            () => new Error(`proxy said ${FORMS['unicode escape mixed with literals and \\/']}`),
        ],
        [
            'headers.authorization property',
            () =>
                Object.assign(new Error('socket failed'), {
                    headers: { authorization: `Bearer ${KEY}` },
                }),
        ],
        [
            'requestHeaders property',
            () =>
                Object.assign(new Error('socket failed'), {
                    requestHeaders: { authorization: `Bearer ${KEY}` },
                }),
        ],
        ['code carries the key', () => Object.assign(new Error('bad'), { code: `E_${KEY}` })],
        ['thrown plain object', () => ({ authorization: `Bearer ${KEY}`, message: `m ${KEY}` })],
        [
            'nested cause',
            () =>
                new TypeError('fetch failed', {
                    cause: Object.assign(new Error(`connect to ${FORMS['percent upper hex']}`), {
                        code: 'ECONNREFUSED',
                        config: { headers: { Authorization: `Bearer ${KEY}` } },
                    }),
                }),
        ],
    ]
    for (const [name, make] of cases) {
        test(name, async () => {
            const thrown = make()
            const error = await throwing(thrown)
                .getInfo()
                .catch((e: unknown) => e)
            expect(error).toBeInstanceOf(sdk.NetworkError)
            expectNoKey(surfaces(error))
            const cause = (error as Error).cause as Record<string, unknown>
            expect(cause).not.toBe(thrown)
            // none of the original's other properties are carried over
            for (const k of ['headers', 'requestHeaders', 'config', 'authorization']) {
                expect(k in cause).toBe(false)
            }
        })
    }

    test('the nested cause keeps a safe code, so connect failures are still retried', async () => {
        let calls = 0
        const c = new sdk.Client({
            apiKey: KEY,
            v2BaseUrl: 'https://api.test/v2',
            maxRetries: 2,
            sleep: async () => {},
            fetch: async () => {
                calls++
                throw new TypeError('fetch failed', {
                    cause: Object.assign(new Error(`refused ${KEY}`), { code: 'ECONNREFUSED' }),
                })
            },
        })
        const error = (await c.verify.bankByPayload('P').catch((e) => e)) as Error
        expect(calls).toBe(3)
        const inner = (error.cause as Error).cause as Error & { code: string }
        expect(inner.code).toBe('ECONNREFUSED')
        expect(inner.message).toBe(`refused ${REDACTED}`)
    })

    test('a timeout keeps RequestTimeoutError and the caller reason stays the same object', async () => {
        const slow = new sdk.Client({
            apiKey: KEY,
            v2BaseUrl: 'https://api.test/v2',
            maxRetries: 0,
            timeout: 20,
            fetch: (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () =>
                        reject(Object.assign(new Error(`aborted ${KEY}`), { name: 'AbortError' })),
                    )
                }),
        })
        const timeout = await slow.getInfo().catch((e) => e)
        expect(timeout).toBeInstanceOf(sdk.RequestTimeoutError)
        expectNoKey(surfaces(timeout))
        const controller = new AbortController()
        const reason = new Error('caller stop')
        setTimeout(() => controller.abort(reason), 5)
        const stopped = await slow
            .getInfo({ signal: controller.signal, timeout: 1000 })
            .catch((e) => e)
        expect(stopped).toBe(reason)
    })
})

test('keys shorter than 4 characters are not redacted', async () => {
    const { client: short } = mockClient(() => v2error(400, 'VALIDATION_ERROR', 'abc def'), {
        apiKey: 'abc',
        maxRetries: 0,
    })
    const error = (await short.getInfo().catch((e) => e)) as sdk.ApiError
    expect(error.message).toBe('abc def')
})
