// Runs every fixture in test/fixtures against the SDK: recorded API answers, retry behaviour
// and webhook signatures.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeResponse } from '../src/core/http.ts'
import { settings } from '../src/core/settings.ts'
import * as sdk from '../src/index.ts'
import { type ModelName, parseModel } from '../src/models.ts'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))
const KEY = 'sk_test_conformance_0000'
const V1 = 'https://api.test/v1'
const V2 = 'https://api.test/v2'

// biome-ignore lint/suspicious/noExplicitAny: fixtures are free-form JSON
type Json = any

function listJson(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return listJson(path)
        return entry.name.endsWith('.json') ? [path] : []
    })
}

const fixtures: Json[] = listJson(FIXTURES)
    .map((path) => JSON.parse(readFileSync(path, 'utf8')))
    .filter((f) => f && typeof f === 'object' && typeof f.conformance === 'string')

const byKind = (kind: string) => fixtures.filter((f) => f.conformance === kind)

function bodyText(body: Json): string {
    if (body && typeof body === 'object' && '_nonJson' in body) return String(body._nonJson)
    return JSON.stringify(body)
}

function toResponse(r: Json): Response {
    return new Response(bodyText(r.body), { status: r.status, headers: r.headers ?? {} })
}

function plain(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value))
}

interface Captured {
    url: URL
    init: RequestInit
}

const pick = (args: Json, keys: string[]) =>
    Object.fromEntries(keys.filter((k) => k in args).map((k) => [k, args[k]]))
const VERIFY = ['remark', 'matchAccount', 'matchAmount', 'checkDuplicate']
const file = (args: Json) => join(FIXTURES, args.file)

// Fixture operation name -> SDK call.
const operations: Record<string, (c: sdk.Client, a: Json) => Promise<unknown>> = {
    getInfo: (c) => c.getInfo(),
    'verify.bankByPayload': (c, a) => c.verify.bankByPayload(a.payload, pick(a, VERIFY)),
    'verify.bankByImage': (c, a) => c.verify.bankByImage(file(a), pick(a, VERIFY)),
    'verify.bankByBase64': (c, a) => c.verify.bankByBase64(a.base64, pick(a, VERIFY)),
    'verify.bankByUrl': (c, a) => c.verify.bankByUrl(a.url, pick(a, VERIFY)),
    'verify.truewalletByImage': (c, a) => c.verify.truewalletByImage(file(a), pick(a, VERIFY)),
    'verify.truewalletByBase64': (c, a) => c.verify.truewalletByBase64(a.base64, pick(a, VERIFY)),
    'verify.truewalletByUrl': (c, a) => c.verify.truewalletByUrl(a.url, pick(a, VERIFY)),
    'banks.list': (c) => c.banks.list(),
    'bankAccounts.list': (c, a) => c.bankAccounts.list(a),
    'bankAccounts.listAll': (c, a) => c.bankAccounts.listAll(a),
    'bankAccounts.get': (c, a) => c.bankAccounts.get(a.id),
    'bankAccounts.create': (c, a) => c.bankAccounts.create(a),
    'bankAccounts.update': (c, { id, ...rest }) => c.bankAccounts.update(id, rest),
    'bankAccounts.link': (c, a) => c.bankAccounts.link(a.id),
    'bankAccounts.unlink': (c, a) => c.bankAccounts.unlink(a.id),
    'jobs.submitBank': (c, { payload, ...rest }) => c.jobs.submitBank(payload, rest),
    'jobs.submitBankBatch': (c, { slips, ...rest }) => c.jobs.submitBankBatch(slips, rest),
    'jobs.get': (c, a) => c.jobs.get(a.jobId),
    'v1.getMe': (c) => c.v1.getMe(),
    'v1.verifyBankByPayload': (c, a) => c.v1.verifyBankByPayload(a.payload, pick(a, VERIFY)),
    'v1.verifyBankByImage': (c, a) => c.v1.verifyBankByImage(file(a), pick(a, VERIFY)),
    'v1.verifyBankByBase64': (c, a) => c.v1.verifyBankByBase64(a.base64, pick(a, VERIFY)),
    'v1.verifyBankByUrl': (c, a) => c.v1.verifyBankByUrl(a.url, pick(a, VERIFY)),
    'v1.verifyTruemoneyByImage': (c, a) => c.v1.verifyTruemoneyByImage(file(a), pick(a, VERIFY)),
    'v1.generateQr': (c, a) => c.v1.generateQr(a),
}

const DUPLICATE_SLIP: Record<string, 'BankSlip' | 'TrueWalletSlip'> = {
    'v1.verifyTruemoneyByImage': 'TrueWalletSlip',
}

async function settle(promise: Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> {
    try {
        return { value: await promise }
    } catch (error) {
        return { error }
    }
}

function checkError(error: unknown, want: Json, rawBody: string | null): void {
    const ErrorClass = (sdk as Json)[want.class]
    expect(ErrorClass).toBeDefined()
    expect(error).toBeInstanceOf(ErrorClass)
    expect((error as object).constructor).toBe(ErrorClass)
    const e = error as sdk.ApiError
    if ('code' in want) expect(e.code).toBe(want.code)
    if ('status' in want) expect(e.status).toBe(want.status)
    if ('message' in want) expect(e.message).toBe(want.message)
    if ('requestId' in want) expect(e.requestId).toBe(want.requestId)
    if ('retryAfter' in want) expect(e.retryAfter).toBe(want.retryAfter)
    if (rawBody !== null) expect(e.rawBody).toBe(rawBody)
}

function checkSlip(error: unknown, response: Json): void {
    if (error instanceof sdk.DuplicateSlipError && response.body?.data) {
        expect(plain(error.slip)).toEqual(response.body.data)
    }
}

async function captureRequest(init: RequestInit) {
    const headers = new Headers(init.headers)
    const out: Json = { headers }
    if (init.body instanceof FormData) {
        const fields: Record<string, string> = {}
        const files: Json[] = []
        for (const [field, value] of init.body.entries()) {
            if (typeof value === 'string') {
                fields[field] = value
            } else {
                const part = value as File
                const bytes = new Uint8Array(await part.arrayBuffer())
                files.push({
                    field,
                    filename: part.name,
                    contentType: part.type,
                    size: bytes.byteLength,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                })
            }
        }
        out.multipart = { fields, files }
    } else if (typeof init.body === 'string') {
        out.body = JSON.parse(init.body)
    }
    return out
}

describe('fixtures: call', () => {
    for (const fx of byKind('call')) {
        test(fx.id, async () => {
            const calls: Captured[] = []
            const client = new sdk.Client({
                apiKey: KEY,
                v1BaseUrl: V1,
                v2BaseUrl: V2,
                maxRetries: 0,
                fetch: async (input, init) => {
                    calls.push({ url: new URL(String(input)), init: init ?? {} })
                    return toResponse(fx.response)
                },
            })
            const run = operations[fx.operation]
            expect(run).toBeDefined()
            const { value, error } = await settle(
                (run as NonNullable<typeof run>)(client, fx.call.args),
            )

            const want = fx.request
            expect(calls.length).toBe(1)
            const sent = calls[0] as Captured
            expect(sent.init.method).toBe(want.method)
            expect(`${sent.url.origin}${sent.url.pathname}`).toBe(
                `${fx.api === 'v1' ? V1 : V2}${want.path}`,
            )
            expect(Object.fromEntries(sent.url.searchParams)).toEqual(want.query ?? {})
            const captured = await captureRequest(sent.init)
            expect(captured.headers.get('authorization')).toBe(`Bearer ${KEY}`)
            expect(captured.headers.get('user-agent')).toMatch(
                new RegExp(`^${settings.userAgentProduct}/`),
            )
            if (want.contentType === 'application/json') {
                expect(captured.headers.get('content-type')).toBe('application/json')
                expect(captured.body).toEqual(want.body)
            } else if (want.contentType === 'multipart/form-data') {
                expect(captured.multipart.fields).toEqual(want.multipart.fields)
                expect(captured.multipart.files).toEqual(
                    want.multipart.files.map(({ file: _file, ...rest }: Json) => rest),
                )
            } else {
                expect(sent.init.body).toBeUndefined()
            }

            if (fx.expect.model) {
                expect(error).toBeUndefined()
                expect(plain(value)).toEqual(fx.response.body.data)
                const meta = (value as { meta: sdk.ResponseMeta }).meta
                expect(meta.status).toBe(fx.response.status)
                expect(Object.keys(value as object)).not.toContain('meta')
            } else {
                expect(value).toBeUndefined()
                checkError(error, fx.expect.error, bodyText(fx.response.body))
                checkSlip(error, fx.response)
            }
        })
    }
})

describe('fixtures: response-only', () => {
    for (const fx of byKind('response-only')) {
        test(fx.id, () => {
            const r = fx.response
            const text = bodyText(r.body)
            const decode = () =>
                decodeResponse(
                    fx.api,
                    r.status,
                    r.headers ?? {},
                    text,
                    DUPLICATE_SLIP[fx.operation],
                )
            if (fx.expect.model) {
                const { data } = decode()
                expect(plain(parseModel(fx.expect.model as ModelName, data))).toEqual(r.body.data)
            } else {
                let error: unknown
                try {
                    decode()
                } catch (e) {
                    error = e
                }
                checkError(error, fx.expect.error, text)
                checkSlip(error, r)
            }
        })
    }
})

function transportError(kind: string, signal: AbortSignal | null | undefined): Promise<Response> {
    if (kind === 'timeout') {
        return new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')),
            )
        })
    }
    const code = kind === 'connect' ? 'ECONNREFUSED' : 'ECONNRESET'
    const cause = Object.assign(new Error(`${code} 203.0.113.10:443`), { code })
    return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause }))
}

describe('fixtures: behaviour', () => {
    for (const fx of byKind('behaviour')) {
        test(fx.id, async () => {
            const steps: Json[] = fx.steps
            const delays: number[] = []
            let requests = 0
            const client = new sdk.Client({
                apiKey: KEY,
                v1BaseUrl: V1,
                v2BaseUrl: V2,
                timeout: 50,
                ...fx.call.clientOptions,
                sleep: async (ms) => {
                    delays.push(ms)
                },
                fetch: async (_input, init) => {
                    const step = steps[Math.min(requests, steps.length - 1)]
                    requests++
                    if (step.transportError)
                        return transportError(step.transportError, init?.signal)
                    return toResponse(step)
                },
            })
            const run = operations[fx.call.operation]
            expect(run).toBeDefined()
            const { value, error } = await settle(
                (run as NonNullable<typeof run>)(client, fx.call.args),
            )
            expect(requests).toBe(fx.expect.requests)
            if (fx.expect.result) {
                expect(error).toBeUndefined()
                const last = steps[requests - 1]
                expect(plain(value)).toEqual(last.body.data)
            } else {
                const ErrorClass = (sdk as Json)[fx.expect.error]
                expect(error).toBeInstanceOf(ErrorClass)
                expect((error as object).constructor).toBe(ErrorClass)
            }
            if (fx.expect.minDelaySeconds !== undefined) {
                expect(delays[0]).toBeGreaterThanOrEqual(fx.expect.minDelaySeconds * 1000)
            }
            expect(delays.length).toBe(Math.max(0, requests - 1))
        })
    }
})

describe('fixtures: webhook', () => {
    const signatures = fixtures.find((f) => f.id === 'webhook.signatures')
    const events = fixtures.find((f) => f.id === 'webhook.events')

    test('signature header name', () => {
        expect(sdk.WEBHOOK_SIGNATURE_HEADER).toBe(signatures.headers.thunder)
    })

    for (const c of signatures.cases) {
        test(`signature ${c.id}`, () => {
            const raw = readFileSync(join(FIXTURES, c.body))
            const asBytes = new Uint8Array(raw)
            const asText = raw.toString('utf8')
            expect(sdk.verifyWebhookSignature(asBytes, c.signature, signatures.secret)).toBe(
                c.valid,
            )
            expect(sdk.verifyWebhookSignature(asText, c.signature, signatures.secret)).toBe(c.valid)
            if (!c.valid) {
                expect(() =>
                    sdk.constructWebhookEvent(asBytes, c.signature, signatures.secret),
                ).toThrow(sdk.WebhookSignatureError)
            } else {
                const event = sdk.constructWebhookEvent(asBytes, c.signature, signatures.secret)
                expect(plain(event)).toEqual(JSON.parse(asText))
            }
        })
    }

    for (const c of events.cases) {
        test(`event ${c.id}`, () => {
            const raw = readFileSync(join(FIXTURES, c.body), 'utf8')
            expect(plain(sdk.parseWebhookEvent(raw))).toEqual(c.expect.json)
        })
    }
})

test('every SDK operation has a fixture', () => {
    const covered = new Set(
        fixtures.flatMap((f) => [f.operation, f.call?.operation]).filter(Boolean),
    )
    for (const op of Object.keys(operations)) expect(covered.has(op)).toBe(true)
})
