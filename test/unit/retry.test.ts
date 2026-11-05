import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { backoffDelay, isConnectFailure } from '../../src/core/http.ts'
import * as sdk from '../../src/index.ts'
import { mockClient, ok, slipResult, v2error } from './helpers.ts'

const connectError = () =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
const resetError = () =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })

describe('retry rules', () => {
    test('backoff doubles from 0.5 s, caps at 8 s, jitter 50 to 100 percent', () => {
        expect(backoffDelay(0, () => 1)).toBe(500)
        expect(backoffDelay(0, () => 0)).toBe(250)
        expect(backoffDelay(3, () => 1)).toBe(4000)
        expect(backoffDelay(10, () => 1)).toBe(8000)
        expect(backoffDelay(10, () => 0)).toBe(4000)
    })

    test('classifies connect failures, including nested and aggregate causes', () => {
        expect(isConnectFailure(connectError())).toBe(true)
        expect(isConnectFailure({ cause: { errors: [{ code: 'ENETUNREACH' }] } })).toBe(true)
        expect(isConnectFailure({ code: 'ConnectionRefused' })).toBe(true)
        expect(isConnectFailure({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } })).toBe(true)
        expect(isConnectFailure(resetError())).toBe(false)
        expect(isConnectFailure(new Error('socket hang up'))).toBe(false)
    })

    test('a real refused connection counts as a connect failure', async () => {
        const server = createServer()
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const { port } = server.address() as { port: number }
        await new Promise<void>((resolve) => server.close(() => resolve()))
        const error = await fetch(`http://127.0.0.1:${port}/`).catch((e) => e)
        expect(isConnectFailure(error)).toBe(true)
        const client = new sdk.Client({
            apiKey: 'k',
            v2BaseUrl: `http://127.0.0.1:${port}`,
            maxRetries: 1,
            sleep: async () => {},
        })
        const result = await client.verify.bankByPayload('P').catch((e) => e)
        expect(result).toBeInstanceOf(sdk.NetworkError)
        expect(result).not.toBeInstanceOf(sdk.RequestTimeoutError)
    })

    test('write calls retry 429 and connect failures but not 500 or resets', async () => {
        const cases: Array<[() => Response | never, number]> = [
            [() => v2error(429, 'RATE_LIMIT_EXCEEDED', 'x', { 'retry-after': '1' }), 2],
            [
                () => {
                    throw connectError()
                },
                2,
            ],
            [() => v2error(500, 'INTERNAL_SERVER_ERROR'), 1],
            [
                () => {
                    throw resetError()
                },
                1,
            ],
        ]
        for (const [first, requests] of cases) {
            const { client, sent } = mockClient((_s, i) => (i === 0 ? first() : ok({ id: 1 })), {
                maxRetries: 2,
            })
            await client.bankAccounts
                .create({
                    bankCode: '004',
                    bankNumber: '1',
                    nameTh: 'a',
                    nameEn: 'a',
                    type: 'NATURAL',
                })
                .catch(() => {})
            expect(sent.length).toBe(requests)
        }
    })

    test('safe calls retry every listed 5xx, then give up', async () => {
        for (const status of [500, 502, 503, 504]) {
            const { client, sent, delays } = mockClient(() => v2error(status, 'X'), {
                maxRetries: 3,
                random: () => 1,
            })
            await expect(client.getInfo()).rejects.toBeInstanceOf(sdk.ServerError)
            expect(sent.length).toBe(4)
            expect(delays).toEqual([500, 1000, 2000])
        }
        const { client, sent } = mockClient(() => v2error(501, 'X'), { maxRetries: 3 })
        await expect(client.getInfo()).rejects.toBeInstanceOf(sdk.ServerError)
        expect(sent.length).toBe(1)
    })

    test('per-call maxRetries overrides the client', async () => {
        const { client, sent } = mockClient(() => v2error(503, 'X'), { maxRetries: 3 })
        await client.getInfo({ maxRetries: 0 }).catch(() => {})
        expect(sent.length).toBe(1)
    })

    test('billed 503 with Retry-After is still not retried', async () => {
        const { client, sent } = mockClient(
            (_s, i) =>
                i === 0
                    ? v2error(503, 'RENEWAL_TEMPORARILY_UNAVAILABLE', 'x', { 'retry-after': '1' })
                    : ok(slipResult),
            { maxRetries: 2 },
        )
        await expect(client.verify.bankByPayload('P')).rejects.toBeInstanceOf(
            sdk.ServiceUnavailableError,
        )
        expect(sent.length).toBe(1)
    })

    test('timeouts: per attempt, retried only for safe calls', async () => {
        const hang = (_s: unknown, _i: number) =>
            new Promise<Response>((_, reject) => {
                const signal = (_s as { init: RequestInit }).init.signal
                signal?.addEventListener('abort', () =>
                    reject(new DOMException('aborted', 'AbortError')),
                )
            })
        const safe = mockClient(hang, { timeout: 20, maxRetries: 1 })
        await expect(safe.client.getInfo()).rejects.toBeInstanceOf(sdk.RequestTimeoutError)
        expect(safe.sent.length).toBe(2)
        const billed = mockClient(hang, { timeout: 20, maxRetries: 1 })
        await expect(
            billed.client.verify.bankByPayload('P', { timeout: 10 }),
        ).rejects.toBeInstanceOf(sdk.RequestTimeoutError)
        expect(billed.sent.length).toBe(1)
    })

    test('an abort signal cancels the call and the wait between retries', async () => {
        const controller = new AbortController()
        const { client, sent } = mockClient(
            () => {
                controller.abort(new Error('stop'))
                return v2error(503, 'X')
            },
            {
                maxRetries: 5,
                sleep: (_ms, signal) =>
                    new Promise((_, reject) =>
                        signal?.addEventListener('abort', () => reject(signal.reason)),
                    ),
            },
        )
        const error = await client.getInfo({ signal: controller.signal }).catch((e) => e)
        expect((error as Error).message).toBe('stop')
        expect(sent.length).toBe(1)
        await expect(client.getInfo({ signal: controller.signal })).rejects.toThrow('stop')
        expect(sent.length).toBe(1)
    })

    test('a non-JSON error body keeps the raw text', async () => {
        const { client } = mockClient(
            () => new Response('<html>Bad gateway</html>', { status: 502 }),
            { maxRetries: 0 },
        )
        const error = (await client.getInfo().catch((e) => e)) as sdk.ServerError
        expect(error).toBeInstanceOf(sdk.ServerError)
        expect(error.code).toBeNull()
        expect(error.message).toBe('HTTP 502')
        expect(error.rawBody).toBe('<html>Bad gateway</html>')
    })
})
