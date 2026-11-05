import { describe, expect, test } from 'bun:test'
import * as sdk from '../../src/index.ts'
import { mockClient, ok, PNG, v2error } from './helpers.ts'

// A billed call is sent once. When the request may already have reached the API (no answer in
// time, a 5xx, a reset connection) the SDK does not send it again, so one slip is never charged
// twice. Default maxRetries (2) is kept, so a retry would show up.
const BASE64 = Buffer.from(PNG).toString('base64')
const URL = 'https://slips.test/slip.png'
const HOOK = 'https://hooks.test/slip'

type Call = (client: sdk.Client) => Promise<unknown>

const BILLED: Array<[string, Call]> = [
    ['verify.bankByPayload', (c) => c.verify.bankByPayload('P')],
    ['verify.bankByImage', (c) => c.verify.bankByImage(PNG)],
    ['verify.bankByBase64', (c) => c.verify.bankByBase64(BASE64)],
    ['verify.bankByUrl', (c) => c.verify.bankByUrl(URL)],
    ['verify.truewalletByImage', (c) => c.verify.truewalletByImage(PNG)],
    ['verify.truewalletByBase64', (c) => c.verify.truewalletByBase64(BASE64)],
    ['verify.truewalletByUrl', (c) => c.verify.truewalletByUrl(URL)],
    ['v1.verifyBankByPayload', (c) => c.v1.verifyBankByPayload('P')],
    ['v1.verifyBankByImage', (c) => c.v1.verifyBankByImage(PNG)],
    ['v1.verifyBankByBase64', (c) => c.v1.verifyBankByBase64(BASE64)],
    ['v1.verifyBankByUrl', (c) => c.v1.verifyBankByUrl(URL)],
    ['v1.verifyTruemoneyByImage', (c) => c.v1.verifyTruemoneyByImage(PNG)],
    ['jobs.submitBank (payload)', (c) => c.jobs.submitBank('P', { callbackUrl: HOOK })],
    [
        'jobs.submitBankBatch',
        (c) => c.jobs.submitBankBatch([{ payload: 'P' }, { payload: 'Q' }], { callbackUrl: HOOK }),
    ],
    [
        'jobs.submitBankMany',
        (c) => c.jobs.submitBankMany([{ payload: 'P' }], { callbackUrl: HOOK }),
    ],
]

const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })

/** Failures after the request was sent, and the error each one must raise. */
const AFTER_SEND: Array<[string, (signal?: AbortSignal | null) => Promise<Response>, unknown]> = [
    [
        'read timeout',
        (signal) =>
            new Promise((_, reject) =>
                signal?.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
        sdk.RequestTimeoutError,
    ],
    ['500', async () => v2error(500, 'INTERNAL_SERVER_ERROR'), sdk.ServerError],
    ['502', async () => v2error(502, 'BAD_GATEWAY'), sdk.ServerError],
    ['503', async () => v2error(503, 'SERVICE_UNAVAILABLE'), sdk.ServiceUnavailableError],
    ['504', async () => v2error(504, 'GATEWAY_TIMEOUT'), sdk.ServerError],
    [
        'connection reset',
        async () => {
            throw reset()
        },
        sdk.NetworkError,
    ],
]

function run(answer: (signal?: AbortSignal | null) => Promise<Response>) {
    return mockClient((sent) => answer(sent.init.signal), { timeout: 20 })
}

describe('billed calls are sent exactly once after the request may have arrived', () => {
    for (const [name, call] of BILLED) {
        for (const [failure, answer, ErrorClass] of AFTER_SEND) {
            test(`${name}: ${failure}`, async () => {
                const { client, sent } = run(answer)
                const error = await call(client).catch((e: unknown) => e)
                const raised = error instanceof sdk.BatchSubmitError ? error.cause : error
                expect(raised).toBeInstanceOf(ErrorClass as new () => Error)
                expect(sent.length).toBe(1)
                // v1 verify by payload is a billed GET; the rule is the same
                expect(sent[0]?.init.method).toBe(
                    name === 'v1.verifyBankByPayload' ? 'GET' : 'POST',
                )
            })
        }
    }

    test('control: the same failures are retried on a safe read', async () => {
        for (const [, answer] of AFTER_SEND) {
            const { client, sent } = run(answer)
            await client.getInfo().catch(() => undefined)
            expect(sent.length).toBe(3)
        }
    })

    test('control: a billed call succeeds with one send', async () => {
        const { client, sent } = mockClient(() =>
            ok({ amountInSlip: 1, rawSlip: { payload: 'P' } }),
        )
        await client.verify.bankByPayload('P').catch(() => undefined)
        expect(sent.length).toBe(1)
    })
})
