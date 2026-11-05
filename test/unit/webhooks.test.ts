import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { settings } from '../../src/core/settings.ts'
import { hmacSha256, sha256, toHex } from '../../src/core/sha256.ts'
import * as sdk from '../../src/index.ts'

const SECRET = 'whsec_unit_test'
const sign = (body: string | Uint8Array, secret = SECRET) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

const saved = process.env[settings.env.webhookSecret]
afterEach(() => {
    if (saved === undefined) delete process.env[settings.env.webhookSecret]
    else process.env[settings.env.webhookSecret] = saved
})

describe('sha256 and hmac', () => {
    test('match node:crypto for lengths 0 to 300 and 1 MB', () => {
        const lengths = [...Array.from({ length: 301 }, (_, i) => i), 1024 * 1024]
        for (const n of lengths) {
            const data = new Uint8Array(randomBytes(n))
            expect(toHex(sha256(data))).toBe(createHash('sha256').update(data).digest('hex'))
        }
    })

    test('hmac matches node:crypto, including keys longer than a block', () => {
        for (const keyLength of [0, 1, 32, 64, 65, 200]) {
            const key = new Uint8Array(randomBytes(keyLength))
            const message = new Uint8Array(randomBytes(500))
            expect(toHex(hmacSha256(key, message))).toBe(
                createHmac('sha256', key).update(message).digest('hex'),
            )
        }
    })
})

describe('webhook helpers', () => {
    const body = JSON.stringify({
        jobId: 'j',
        batchId: null,
        status: 'not_found',
        data: null,
        timestamp: 't',
        extra: 1,
    })

    test('verifies string, bytes and ArrayBuffer bodies; header arrays use the first value', () => {
        const signature = sign(body)
        const bytes = new TextEncoder().encode(body)
        expect(sdk.verifyWebhookSignature(body, signature, SECRET)).toBe(true)
        expect(sdk.verifyWebhookSignature(bytes, signature, SECRET)).toBe(true)
        expect(sdk.verifyWebhookSignature(bytes.buffer as ArrayBuffer, signature, SECRET)).toBe(
            true,
        )
        expect(sdk.verifyWebhookSignature(body, [signature, 'x'], SECRET)).toBe(true)
        expect(sdk.verifyWebhookSignature(`${body} `, signature, SECRET)).toBe(false)
        expect(sdk.verifyWebhookSignature(body, undefined, SECRET)).toBe(false)
        expect(sdk.verifyWebhookSignature(body, `${signature}0`, SECRET)).toBe(false)
    })

    test('reads the secret from the env variable when none is passed', () => {
        process.env[settings.env.webhookSecret] = SECRET
        expect(sdk.verifyWebhookSignature(body, sign(body))).toBe(true)
        delete process.env[settings.env.webhookSecret]
        expect(() => sdk.verifyWebhookSignature(body, sign(body))).toThrow(sdk.InputError)
    })

    test('construct verifies then parses; parse drops unknown fields', () => {
        const event = sdk.constructWebhookEvent(body, sign(body), SECRET)
        expect(event).toEqual({
            jobId: 'j',
            batchId: null,
            status: 'not_found',
            data: null,
            timestamp: 't',
        })
        expect(() => sdk.constructWebhookEvent(body, sign(body, 'other'), SECRET)).toThrow(
            sdk.WebhookSignatureError,
        )
        expect(() => sdk.parseWebhookEvent('not json')).toThrow(sdk.InputError)
        expect(() => sdk.parseWebhookEvent('[1]')).toThrow(sdk.InputError)
    })

    test('a signed body that is not a webhook event throws InputError, not an empty event', () => {
        const bodies = [
            'not json',
            '[]',
            'null',
            '{}',
            '{"jobId":"j","status":"success"}',
            '{"jobId":null,"status":"success","timestamp":"t"}',
            '{"jobId":"j","status":1,"timestamp":"t"}',
        ]
        for (const raw of bodies) {
            let thrown: unknown
            try {
                sdk.constructWebhookEvent(raw, sign(raw), SECRET)
            } catch (error) {
                thrown = error
            }
            expect(thrown, raw).toBeInstanceOf(sdk.InputError)
            expect((thrown as InstanceType<typeof sdk.InputError>).code, raw).toBe(
                'INVALID_ARGUMENT',
            )
            expect(() => sdk.parseWebhookEvent(raw), raw).toThrow(sdk.InputError)
        }
        expect(() => sdk.parseWebhookEvent('{}')).toThrow(
            'webhook body must contain jobId, status and timestamp',
        )
    })

    test('the signature is checked before the body', () => {
        expect(() => sdk.constructWebhookEvent('{}', sign('{}', 'other'), SECRET)).toThrow(
            sdk.WebhookSignatureError,
        )
    })

    test('the header name is X-Thunder-Signature', () => {
        expect(sdk.WEBHOOK_SIGNATURE_HEADER).toBe(settings.webhook.signatureHeader)
    })
})
