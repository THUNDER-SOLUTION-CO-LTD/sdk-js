import { InputError, WebhookSignatureError } from './core/errors.js'
import { readEnv } from './core/runtime.js'
import { settings } from './core/settings.js'
import { hmacSha256, toHex } from './core/sha256.js'
import { parseModel, type WebhookEvent } from './models.js'

/** Name of the header that carries the webhook signature. */
export const WEBHOOK_SIGNATURE_HEADER: string = settings.webhook.signatureHeader

/** The webhook body exactly as received: a string or the raw bytes. */
export type WebhookBody = string | Uint8Array | ArrayBuffer

/** A header value as web and Node frameworks hand it over. */
export type SignatureHeader = string | readonly string[] | null | undefined

const PREFIX = settings.webhook.signaturePrefix
const SIGNATURE = /^[0-9a-f]{64}$/

function toBytes(body: WebhookBody): Uint8Array {
    if (typeof body === 'string') return new TextEncoder().encode(body)
    if (body instanceof ArrayBuffer) return new Uint8Array(body)
    if (body instanceof Uint8Array) return body
    throw new InputError('INVALID_ARGUMENT', 'webhook body must be a string or bytes')
}

function secretOrEnv(secret: string | undefined): string {
    const value = secret ?? readEnv(settings.env.webhookSecret)
    if (!value) {
        throw new InputError(
            'INVALID_ARGUMENT',
            `no webhook secret: pass one or set ${settings.env.webhookSecret}`,
        )
    }
    return value
}

function equalConstantTime(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

/**
 * Checks a webhook signature: `sha256=` plus the lower-case hex HMAC-SHA256 of the raw body
 * under your webhook secret, compared in constant time. Pass the body exactly as received,
 * before any JSON parsing. A missing header gives false.
 *
 * @param secret Your branch's webhook secret. Defaults to the webhook secret env variable.
 */
export function verifyWebhookSignature(
    rawBody: WebhookBody,
    signatureHeader: SignatureHeader,
    secret?: string,
): boolean {
    const key = secretOrEnv(secret)
    const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
    if (typeof header !== 'string' || !header.startsWith(PREFIX)) return false
    const given = header.slice(PREFIX.length)
    if (!SIGNATURE.test(given)) return false
    const expected = toHex(hmacSha256(new TextEncoder().encode(key), toBytes(rawBody)))
    return equalConstantTime(given, expected)
}

/**
 * Parses a webhook body into a {@link WebhookEvent} without checking the signature. Throws
 * {@link InputError} when the body is not a JSON object with string `jobId`, `status` and
 * `timestamp` fields.
 */
export function parseWebhookEvent(rawBody: WebhookBody): WebhookEvent {
    const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(toBytes(rawBody))
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch (cause) {
        throw new InputError('INVALID_ARGUMENT', 'webhook body is not JSON', { cause })
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new InputError('INVALID_ARGUMENT', 'webhook body is not a JSON object')
    }
    const fields = value as Record<string, unknown>
    if (
        typeof fields.jobId !== 'string' ||
        typeof fields.status !== 'string' ||
        typeof fields.timestamp !== 'string'
    ) {
        throw new InputError(
            'INVALID_ARGUMENT',
            'webhook body must contain jobId, status and timestamp',
        )
    }
    return parseModel('WebhookEvent', value)
}

/**
 * Verifies the signature, then parses the body. Throws {@link WebhookSignatureError} when the
 * signature is missing or wrong, and {@link InputError} when a signed body is not a webhook event.
 */
export function constructWebhookEvent(
    rawBody: WebhookBody,
    signatureHeader: SignatureHeader,
    secret?: string,
): WebhookEvent {
    if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
        throw new WebhookSignatureError(
            `webhook signature in ${WEBHOOK_SIGNATURE_HEADER} is missing or does not match`,
        )
    }
    return parseWebhookEvent(rawBody)
}
