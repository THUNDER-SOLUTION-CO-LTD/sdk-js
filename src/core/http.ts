import { parseModel } from '../models.js'
import { errorCodes, statusFallback } from './error-codes.js'
import {
    type ApiError,
    apiErrorClass,
    type ErrorDetails,
    NetworkError,
    RequestTimeoutError,
} from './errors.js'
import {
    headersToRecord,
    type ResponseMeta,
    rateLimitFrom,
    requestIdFrom,
    retryAfterFrom,
} from './meta.js'
import {
    noRedact,
    type Redactor,
    redactBody,
    redactHeaders,
    redactor,
    sanitizeCause,
} from './redact.js'

/** Which API version a call goes to. */
export type ApiVersion = 'v1' | 'v2'

/**
 * How a call may be retried.
 * - `safe`: reads and idempotent calls. Retried on network errors, 429 and 5xx.
 * - `write`: creates and changes. Retried only when the request never left, and on 429.
 * - `billed`: calls that can spend quota. Same rule as `write`, so a slip is never billed twice.
 */
export type RetryClass = 'safe' | 'write' | 'billed'

/** Options every call accepts. */
export interface RequestOptions {
    /** Cancels the call, including any wait between retries. */
    signal?: AbortSignal
    /** Per-attempt timeout in milliseconds for this call. */
    timeout?: number
    /** Retries for this call. */
    maxRetries?: number
}

export interface RequestSpec extends RequestOptions {
    api: ApiVersion
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    path: string
    query?: Record<string, string | undefined>
    json?: unknown
    form?: FormData
    retry: RetryClass
    /** Which slip model a v1 `duplicate_slip` error carries. */
    duplicateSlip?: 'BankSlip' | 'TrueWalletSlip'
}

export interface RawResponse {
    data: unknown
    meta: ResponseMeta
}

/** The part of `fetch` the SDK uses. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface TransportConfig {
    v1BaseUrl: string
    v2BaseUrl: string
    timeout: number
    maxRetries: number
    userAgent: string
    fetch: FetchLike
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>
    random: () => number
    apiKey: () => Promise<string>
}

const RETRY_STATUS = new Set([500, 502, 503, 504])
const MAX_RETRY_AFTER_SECONDS = 60

// Error codes that mean the request bytes never left this machine.
const CONNECT_CODES = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EAI_NONAME',
    'EAI_FAIL',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EADDRNOTAVAIL',
    'UND_ERR_CONNECT_TIMEOUT',
    'ConnectionRefused',
    'FailedToOpenSocket',
    'DNSException',
])

function errorCodesOf(error: unknown, depth = 0): string[] {
    if (!error || typeof error !== 'object' || depth > 3) return []
    const e = error as { code?: unknown; cause?: unknown; errors?: unknown }
    const out = typeof e.code === 'string' ? [e.code] : []
    out.push(...errorCodesOf(e.cause, depth + 1))
    if (Array.isArray(e.errors))
        for (const inner of e.errors) out.push(...errorCodesOf(inner, depth + 1))
    return out
}

/** True when a fetch failure happened before the request was sent (DNS, connect, TLS). */
export function isConnectFailure(error: unknown): boolean {
    return errorCodesOf(error).some(
        (code) =>
            CONNECT_CODES.has(code) ||
            code.startsWith('ERR_TLS_') ||
            code.startsWith('ERR_SSL_') ||
            code.includes('CERT') ||
            code.startsWith('UNABLE_TO_'),
    )
}

/** Backoff before retry number `attempt` (0-based), in milliseconds. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
    const base = Math.min(8000, 500 * 2 ** attempt)
    return base * (0.5 + random() * 0.5)
}

function parseJson(text: string): unknown {
    if (!text) return undefined
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorFromResponse(
    api: ApiVersion,
    status: number,
    headers: Record<string, string>,
    text: string,
    parsed: unknown,
    duplicateSlip: RequestSpec['duplicateSlip'],
    redact: Redactor,
): ApiError {
    // Every field below is read from the redacted body.
    const { rawBody, body } = redactBody(text, parsed, redact)
    let code: string | null = null
    let message = ''
    let details: ErrorDetails | null = null
    let slipData: unknown
    if (isObject(body)) {
        if (api === 'v2' && isObject(body.error)) {
            if (typeof body.error.code === 'string') code = body.error.code
            if (typeof body.error.message === 'string') message = body.error.message
        } else if (api === 'v1') {
            if (typeof body.message === 'string') {
                code = body.message
                message = body.message
            }
            if (typeof body.details === 'string' || Array.isArray(body.details)) {
                details = body.details as ErrorDetails
            }
            slipData = body.data
        } else if (typeof body.message === 'string') {
            message = body.message
        }
    }
    const className =
        (code !== null ? errorCodes[api][code] : undefined) ??
        statusFallback[status] ??
        (status >= 500 ? 'ServerError' : 'ApiError')
    const ErrorClass = apiErrorClass(className)
    const slip =
        className === 'DuplicateSlipError' && isObject(slipData)
            ? parseModel(duplicateSlip ?? 'BankSlip', slipData)
            : null
    const safeHeaders = redactHeaders(headers, redact)
    return new ErrorClass({
        status,
        code,
        message: message || `HTTP ${status}`,
        requestId: requestIdFrom(safeHeaders),
        rawBody,
        sensitiveRawBody: text,
        headers: safeHeaders,
        details,
        retryAfter: retryAfterFrom(headers),
        rateLimit: rateLimitFrom(headers),
        slip,
    })
}

/**
 * Turns one HTTP response into `{ data, meta }`, or throws the mapped {@link ApiError}.
 * `redact` removes the API key from everything taken from the response.
 * Exported for the conformance tests; SDK users never need it.
 */
export function decodeResponse(
    api: ApiVersion,
    status: number,
    rawHeaders: Headers | Record<string, string>,
    text: string,
    duplicateSlip?: RequestSpec['duplicateSlip'],
    redact: Redactor = noRedact,
): RawResponse {
    const headers = headersToRecord(rawHeaders)
    const body = parseJson(text)
    const ok = status >= 200 && status < 300
    const successEnvelope =
        isObject(body) && (api === 'v2' ? body.success === true : 'data' in body)
    if (!ok || !successEnvelope) {
        throw errorFromResponse(api, status, headers, text, body, duplicateSlip, redact)
    }
    const safeHeaders = redactHeaders(headers, redact)
    const meta: ResponseMeta = {
        status,
        requestId: requestIdFrom(safeHeaders),
        message:
            api === 'v2' && typeof body.message === 'string' ? redact.text(body.message) : null,
        rateLimit: rateLimitFrom(headers),
        headers: safeHeaders,
    }
    return { data: body.data, meta }
}

/** Sends requests with auth, timeouts and the retry rules. Holds the API key privately. */
export class Transport {
    readonly #config: TransportConfig

    constructor(config: TransportConfig) {
        this.#config = config
    }

    get config(): Readonly<Omit<TransportConfig, 'apiKey'>> {
        const { apiKey: _apiKey, ...rest } = this.#config
        return rest
    }

    #url(spec: RequestSpec): string {
        const base = (spec.api === 'v1' ? this.#config.v1BaseUrl : this.#config.v2BaseUrl).replace(
            /\/+$/,
            '',
        )
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(spec.query ?? {})) {
            if (value !== undefined) params.append(key, value)
        }
        const qs = params.toString()
        return `${base}${spec.path}${qs ? `?${qs}` : ''}`
    }

    async request(spec: RequestSpec): Promise<RawResponse> {
        const config = this.#config
        const maxRetries = Math.max(0, spec.maxRetries ?? config.maxRetries)
        const timeout = spec.timeout ?? config.timeout
        const url = this.#url(spec)
        const apiKey = await config.apiKey()
        const redact = redactor(apiKey)
        const headers: Record<string, string> = {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            'User-Agent': config.userAgent,
        }
        let body: string | FormData | undefined
        if (spec.form) {
            body = spec.form
        } else if (spec.json !== undefined) {
            body = JSON.stringify(spec.json)
            headers['Content-Type'] = 'application/json'
        }

        for (let attempt = 0; ; attempt++) {
            spec.signal?.throwIfAborted()
            const controller = new AbortController()
            let timedOut = false
            const timer = setTimeout(() => {
                timedOut = true
                controller.abort()
            }, timeout)
            const onAbort = () => controller.abort(spec.signal?.reason)
            spec.signal?.addEventListener('abort', onAbort, { once: true })

            let status: number
            let responseHeaders: Headers
            let text: string
            try {
                const response = await config.fetch(url, {
                    method: spec.method,
                    headers,
                    body,
                    signal: controller.signal,
                })
                status = response.status
                responseHeaders = response.headers
                text = await response.text()
            } catch (rawCause) {
                if (spec.signal?.aborted) throw spec.signal.reason
                // Classified from the original below; only the sanitized copy is kept.
                const cause = sanitizeCause(rawCause, redact)
                const error = timedOut
                    ? new RequestTimeoutError(`no response within ${timeout} ms`, { cause })
                    : new NetworkError(`request failed: ${cause.message}`, { cause })
                const retryable =
                    attempt < maxRetries &&
                    (spec.retry === 'safe' || (!timedOut && isConnectFailure(rawCause)))
                if (!retryable) throw error
                spec.signal?.throwIfAborted()
                await config.sleep(backoffDelay(attempt, config.random), spec.signal)
                continue
            } finally {
                clearTimeout(timer)
                spec.signal?.removeEventListener('abort', onAbort)
            }

            try {
                return decodeResponse(
                    spec.api,
                    status,
                    responseHeaders,
                    text,
                    spec.duplicateSlip,
                    redact,
                )
            } catch (error) {
                const apiError = error as ApiError
                const retryable =
                    attempt < maxRetries &&
                    (status === 429 || (spec.retry === 'safe' && RETRY_STATUS.has(status)))
                if (!retryable) throw apiError
                const retryAfter = apiError.retryAfter
                if (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_SECONDS) throw apiError
                const delay =
                    retryAfter !== null ? retryAfter * 1000 : backoffDelay(attempt, config.random)
                spec.signal?.throwIfAborted()
                await config.sleep(delay, spec.signal)
            }
        }
    }
}
