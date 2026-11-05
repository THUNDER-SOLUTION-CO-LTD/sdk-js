import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { settings } from '../../src/core/settings.ts'
import * as sdk from '../../src/index.ts'
import { bodyOf, job, KEY, mockClient, ok, slipResult, V1, V2, v2error } from './helpers.ts'

const ENV_KEYS = [
    settings.env.apiKey,
    settings.env.apiKeyFile,
    settings.env.v1BaseUrl,
    settings.env.v2BaseUrl,
]
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

describe('configuration', () => {
    test('needs an API key', () => {
        for (const k of ENV_KEYS) delete process.env[k]
        expect(() => new sdk.Client()).toThrow(sdk.InputError)
        expect(() => new sdk.Client({ apiKey: '  ' })).toThrow(sdk.InputError)
    })

    test('reads the key file named by the env variable, trimmed', async () => {
        for (const k of ENV_KEYS) delete process.env[k]
        const dir = mkdtempSync(join(tmpdir(), 'sdk-js-unit-'))
        try {
            const path = join(dir, 'key.txt')
            writeFileSync(path, `${KEY}\n`)
            process.env[settings.env.apiKeyFile] = path
            const { client, sent } = mockClient(() => ok({}), { apiKey: undefined })
            await client.getInfo()
            expect(sent[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('a missing key file is an InputError on the first call', async () => {
        for (const k of ENV_KEYS) delete process.env[k]
        process.env[settings.env.apiKeyFile] = '/nonexistent/sdk-key'
        const { client, sent } = mockClient(() => ok({}), { apiKey: undefined })
        await expect(client.getInfo()).rejects.toThrow(sdk.InputError)
        expect(sent.length).toBe(0)
    })

    test('env base URLs and production defaults', () => {
        for (const k of ENV_KEYS) delete process.env[k]
        const plain = new sdk.Client({ apiKey: KEY })
        expect(plain.v2BaseUrl).toBe(settings.baseUrls.v2)
        expect(plain.v1BaseUrl).toBe(settings.baseUrls.v1)
        process.env[settings.env.v2BaseUrl] = 'https://v2.example.test'
        process.env[settings.env.v1BaseUrl] = 'https://v1.example.test/v1'
        const fromEnv = new sdk.Client({ apiKey: KEY })
        expect(fromEnv.v2BaseUrl).toBe('https://v2.example.test')
        expect(fromEnv.v1BaseUrl).toBe('https://v1.example.test/v1')
    })

    test('base URL with a trailing slash; v2 at the root of a host', async () => {
        const { client, sent } = mockClient(() => ok({}), {
            v2BaseUrl: 'https://staging.example.test/',
        })
        await client.getInfo()
        expect(sent[0]?.url.href).toBe('https://staging.example.test/info')
    })

    test('User-Agent is <product>/<version> <runtime>/<version>', async () => {
        const { client, sent } = mockClient(() => ok({}))
        await client.getInfo()
        const ua = sent[0]?.headers.get('user-agent') ?? ''
        expect(ua).toMatch(
            new RegExp(`^${settings.userAgentProduct}/${sdk.VERSION} (bun|node|deno)/\\S+$`),
        )
        expect(client.userAgent).toBe(ua)
    })

    test('rejects bad timeout and maxRetries', () => {
        expect(() => new sdk.Client({ apiKey: KEY, timeout: 0 })).toThrow(sdk.InputError)
        expect(() => new sdk.Client({ apiKey: KEY, maxRetries: -1 })).toThrow(sdk.InputError)
    })
})

describe('the API key stays secret', () => {
    test('not in inspect, JSON, toString or keys of the client', () => {
        const client = new sdk.Client({ apiKey: KEY, v1BaseUrl: V1, v2BaseUrl: V2 })
        const views = [
            inspect(client, { depth: 10, showHidden: true }),
            JSON.stringify(client),
            String(client),
            inspect(client.verify, { depth: 10, showHidden: true }),
            inspect(client.jobs, { depth: 10, showHidden: true }),
            Object.keys(client).join(','),
        ]
        for (const view of views) expect(view).not.toContain(KEY)
    })

    test('not in API errors, network errors or their text', async () => {
        const { client } = mockClient((_s, i) => {
            if (i === 0) return v2error(401, 'INVALID_API_KEY', 'Invalid API key')
            throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
        })
        const errors: unknown[] = []
        await client.getInfo().catch((e) => errors.push(e))
        await client.getInfo({ maxRetries: 0 }).catch((e) => errors.push(e))
        expect(errors[0]).toBeInstanceOf(sdk.AuthenticationError)
        expect(errors[1]).toBeInstanceOf(sdk.NetworkError)
        for (const e of errors) {
            expect(String(e)).not.toContain(KEY)
            expect(inspect(e, { depth: 10, showHidden: true })).not.toContain(KEY)
            expect(JSON.stringify(e)).not.toContain(KEY)
        }
    })
})

describe('errors', () => {
    test('carry status, code, request id, raw body, rate limit and a readable text', async () => {
        const headers = {
            'retry-after': '2',
            'x-ratelimit-limit': '10',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1793000000',
            'x-request-id': 'req-123',
        }
        const { client } = mockClient(
            () => v2error(429, 'RATE_LIMIT_EXCEEDED', 'Slow down', headers),
            {
                maxRetries: 0,
            },
        )
        const error = (await client.getInfo().catch((e) => e)) as sdk.RateLimitError
        expect(error).toBeInstanceOf(sdk.RateLimitError)
        expect(error).toBeInstanceOf(sdk.ApiError)
        expect(error.retryAfter).toBe(2)
        expect(error.rateLimit).toEqual({ limit: 10, remaining: 0, reset: 1793000000 })
        expect(error.requestId).toBe('req-123')
        expect(error.name).toBe('RateLimitError')
        expect(String(error)).toBe('RateLimitError: [429 RATE_LIMIT_EXCEEDED] Slow down')
    })

    test('Retry-After as an HTTP date', async () => {
        const at = new Date(Date.now() + 5000).toUTCString()
        const { client } = mockClient(
            () => v2error(503, 'CALLBACK_UNAVAILABLE', 'x', { 'retry-after': at }),
            {
                maxRetries: 0,
            },
        )
        const error = (await client.getInfo().catch((e) => e)) as sdk.ApiError
        expect(error.retryAfter).toBeGreaterThanOrEqual(4)
        expect(error.retryAfter).toBeLessThanOrEqual(6)
    })

    test('every error class extends ThunderError', () => {
        expect(Object.getPrototypeOf(sdk.ApiError)).toBe(sdk.ThunderError)
        for (const cls of [
            sdk.NetworkError,
            sdk.InputError,
            sdk.WebhookSignatureError,
            sdk.JobWaitTimeoutError,
            sdk.BatchSubmitError,
        ]) {
            expect(cls.prototype).toBeInstanceOf(sdk.ThunderError)
        }
    })

    test('Thunder is the same class as Client', () => {
        expect(sdk.Thunder).toBe(sdk.Client)
        expect(new sdk.Thunder({ apiKey: KEY })).toBeInstanceOf(sdk.Client)
    })

    test('v1 duplicate carries the typed original slip', async () => {
        const { client } = mockClient(
            () =>
                new Response(
                    JSON.stringify({
                        status: 400,
                        message: 'duplicate_slip',
                        data: slipResult.rawSlip,
                    }),
                    {
                        status: 400,
                    },
                ),
        )
        const error = (await client.v1
            .verifyBankByPayload('P', { checkDuplicate: true })
            .catch((e) => e)) as sdk.DuplicateSlipError
        expect(error).toBeInstanceOf(sdk.DuplicateSlipError)
        expect(error.slip).toEqual(slipResult.rawSlip)
    })
})

describe('requests', () => {
    test('options left out are not sent; set options are', async () => {
        const { client, sent } = mockClient(() => ok(slipResult))
        await client.verify.bankByPayload('P')
        await client.verify.bankByPayload('P', {
            checkDuplicate: false,
            matchAmount: 1500.5,
            remark: 'r',
            signal: AbortSignal.timeout(5000),
        })
        expect(bodyOf(sent[0] as never)).toEqual({ payload: 'P' })
        expect(bodyOf(sent[1] as never)).toEqual({
            payload: 'P',
            checkDuplicate: false,
            matchAmount: 1500.5,
            remark: 'r',
        })
    })

    test('update can clear extraVerify with null', async () => {
        const { client, sent } = mockClient(() => ok({ id: 1 }))
        await client.bankAccounts.update(1, { extraVerify: null })
        await client.bankAccounts.update(1, { nameEn: 'X', extraVerify: undefined })
        expect(bodyOf(sent[0] as never)).toEqual({ extraVerify: null })
        expect(bodyOf(sent[1] as never)).toEqual({ nameEn: 'X' })
    })

    test('v1 booleans: strings in query and form, booleans in JSON', async () => {
        const { client, sent } = mockClient(
            () => new Response(JSON.stringify({ status: 200, data: slipResult.rawSlip })),
        )
        await client.v1.verifyBankByPayload('P', { checkDuplicate: false })
        await client.v1.verifyBankByImage(new Uint8Array([0xff, 0xd8, 0xff, 1]), {
            checkDuplicate: true,
        })
        await client.v1.verifyBankByUrl('https://example.test/s.jpg', { checkDuplicate: true })
        expect(sent[0]?.url.searchParams.get('checkDuplicate')).toBe('false')
        const form = sent[1]?.init.body as FormData
        expect(form.get('checkDuplicate')).toBe('true')
        const file = form.get('file') as File
        expect([file.name, file.type]).toEqual(['slip.jpg', 'image/jpeg'])
        expect(bodyOf(sent[2] as never)).toEqual({
            url: 'https://example.test/s.jpg',
            checkDuplicate: true,
        })
    })

    test('local argument checks send nothing', async () => {
        const { client, sent } = mockClient(() => ok({}))
        await expect(client.verify.bankByPayload('')).rejects.toThrow(sdk.InputError)
        await expect(client.bankAccounts.get(0)).rejects.toThrow(sdk.InputError)
        await expect(client.jobs.get('')).rejects.toThrow(sdk.InputError)
        await expect(client.jobs.submitBankBatch([])).rejects.toMatchObject({ code: 'EMPTY_BATCH' })
        const many = Array.from({ length: 101 }, (_, i) => ({ payload: `P${i}` }))
        await expect(client.jobs.submitBankBatch(many)).rejects.toMatchObject({
            code: 'BATCH_TOO_LARGE',
        })
        expect(sent.length).toBe(0)
    })

    test('meta is attached but not serialized', async () => {
        const { client } = mockClient(() =>
            ok({ jobId: 'j' }, { 'x-request-id': 'req-9', 'cf-ray': 'ray-9' }),
        )
        const result = await client.jobs.submitBank('P', {
            callbackUrl: 'https://example.test/hook',
        })
        expect(result.meta.requestId).toBe('req-9')
        expect(result.meta.status).toBe(200)
        expect(JSON.stringify(result)).toBe('{"jobId":"j"}')
        expect(Object.keys(result)).toEqual(['jobId'])
    })

    test('unknown response fields are dropped, absent and null are kept apart', async () => {
        const { client } = mockClient(() =>
            ok({
                ...slipResult,
                matchedAccount: null,
                somethingNew: 1,
                rawSlip: { ...slipResult.rawSlip, extra: true },
            }),
        )
        const result = await client.verify.bankByPayload('P', { matchAccount: true })
        expect(result.matchedAccount).toBeNull()
        expect('isDuplicate' in result).toBe(false)
        expect(JSON.parse(JSON.stringify(result))).toEqual({ ...slipResult, matchedAccount: null })
    })

    test('BankList is iterable and serializes to the array', async () => {
        const banks = [
            {
                code: '002',
                nameTh: 'a',
                nameEn: 'A',
                shortCode: 'BBL',
                swiftCode: 'S',
                extraVerify: null,
            },
            {
                code: '004',
                nameTh: 'b',
                nameEn: 'B',
                shortCode: 'KBANK',
                swiftCode: 'S',
                extraVerify: [{ value: 'v', label: 'l' }],
            },
        ]
        const { client } = mockClient(() => ok(banks))
        const list = await client.banks.list()
        expect(list.length).toBe(2)
        expect([...list].map((b) => b.code)).toEqual(['002', '004'])
        expect(list.find('004')?.shortCode).toBe('KBANK')
        expect(JSON.parse(JSON.stringify(list))).toEqual(banks)
        expect(list.meta.status).toBe(200)
    })

    test('generateQr decodes the PNG', async () => {
        const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47))
        const { client } = mockClient(
            () =>
                new Response(
                    JSON.stringify({
                        status: 200,
                        data: { image: png, mime: 'image/png', payload: '000201' },
                    }),
                ),
        )
        const qr = await client.v1.generateQr({
            type: 'PROMPTPAY',
            msisdn: '0812345678',
            amount: 10,
        })
        expect([...qr.imageBytes()]).toEqual([0x89, 0x50, 0x4e, 0x47])
        expect(Object.keys(qr)).toEqual(['image', 'mime', 'payload'])
    })
})

describe('helpers', () => {
    test('iterate walks every page and stops at total', async () => {
        const all = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }))
        const { client, sent } = mockClient((s) => {
            const page = Number(s.url.searchParams.get('page'))
            const limit = Number(s.url.searchParams.get('limit'))
            return ok({
                items: all.slice((page - 1) * limit, page * limit),
                total: all.length,
                page,
                limit,
            })
        })
        const ids: number[] = []
        for await (const account of client.bankAccounts.iterate({ limit: 2, type: 'NATURAL' }))
            ids.push(account.id)
        expect(ids).toEqual([1, 2, 3, 4, 5])
        expect(sent.map((s) => s.url.search)).toEqual([
            '?type=NATURAL&page=1&limit=2',
            '?type=NATURAL&page=2&limit=2',
            '?type=NATURAL&page=3&limit=2',
        ])
        expect(sent.every((s) => s.url.pathname === '/v2/bank-accounts')).toBe(true)
    })

    test('iterateAll stops on an empty page and uses /all', async () => {
        const { client, sent } = mockClient(() => ok({ items: [], total: 0, page: 1, limit: 100 }))
        const seen: unknown[] = []
        for await (const a of client.bankAccounts.iterateAll()) seen.push(a)
        expect(seen).toEqual([])
        expect(sent[0]?.url.pathname).toBe('/v2/bank-accounts/all')
        expect(sent[0]?.url.searchParams.get('limit')).toBe('100')
    })

    test('waitForJob polls until done and returns failed jobs', async () => {
        const states = ['queued', 'processing', 'done']
        const { client, sent, delays } = mockClient((_s, i) => ok(job(states[i] ?? 'done')))
        const done = await client.jobs.waitForJob('job-1', { interval: 1000 })
        expect(done.status).toBe('done')
        expect(sent.length).toBe(3)
        expect(delays).toEqual([1000, 1000])
        const failing = mockClient(() => ok(job('failed', { error: { code: 'QUOTA_EXCEEDED' } })))
        expect((await failing.client.jobs.waitForJob('job-1')).error?.code).toBe('QUOTA_EXCEEDED')
    })

    test('waitForJob times out with the last job', async () => {
        const { client } = mockClient(() => ok(job('retrying')), {
            sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
        })
        const error = (await client.jobs
            .waitForJob('job-1', { timeout: 20, interval: 500 })
            .catch((e) => e)) as sdk.JobWaitTimeoutError
        expect(error).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect(error.lastJob?.status).toBe('retrying')
    })

    test('submitBankMany sends chunks of 100 in order', async () => {
        const { client, sent } = mockClient((s, i) => {
            const slips = (bodyOf(s) as { slips: unknown[] }).slips
            return ok({
                batchId: `b${i}`,
                jobs: slips.map((_, index) => ({ jobId: `j${i}-${index}`, index })),
            })
        })
        const slips = Array.from({ length: 250 }, (_, i) => ({ payload: `P${i}`, remark: `r${i}` }))
        const batches = await client.jobs.submitBankMany(slips, {
            callbackUrl: 'https://example.test/hook',
        })
        expect(batches.map((b) => b.jobs.length)).toEqual([100, 100, 50])
        const bodies = sent.map(
            (s) => bodyOf(s) as { callbackUrl: string; slips: { payload: string }[] },
        )
        expect(bodies.map((b) => b.slips[0]?.payload)).toEqual(['P0', 'P100', 'P200'])
        expect(bodies.every((b) => b.callbackUrl === 'https://example.test/hook')).toBe(true)
    })

    test('submitBankMany reports what was accepted when a chunk fails', async () => {
        const { client } = mockClient((_s, i) =>
            i === 0
                ? ok({ batchId: 'b0', jobs: [] })
                : v2error(403, 'QUOTA_EXCEEDED', 'Quota exceeded'),
        )
        const slips = Array.from({ length: 150 }, (_, i) => ({ payload: `P${i}` }))
        const error = (await client.jobs
            .submitBankMany(slips)
            .catch((e) => e)) as sdk.BatchSubmitError
        expect(error).toBeInstanceOf(sdk.BatchSubmitError)
        expect(error.submitted.map((b) => b.batchId)).toEqual(['b0'])
        expect(error.failedChunk).toBe(1)
        expect(error.cause).toBeInstanceOf(sdk.QuotaExceededError)
    })
})
