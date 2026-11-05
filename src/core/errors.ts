import type { BankSlip, BatchSubmission, Job, TrueWalletSlip } from '../models.js'
import type { RateLimit } from './meta.js'

/** Base class of every error this SDK throws. */
export class ThunderError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = new.target.name
    }

    override toString(): string {
        return `${this.name}: ${this.message}`
    }
}

/** v1 `details`: a message, or one entry per rejected field. */
export type ErrorDetails =
    | string
    | ReadonlyArray<{ readonly field: string; readonly message: string }>

/** Everything known about an HTTP error response. */
export interface ApiErrorInit {
    status: number
    code: string | null
    message: string
    requestId: string | null
    /** The body as it may be shown: with the API key redacted. */
    rawBody: string
    /** The body exactly as received, for {@link ApiError.sensitiveRawBody}. Defaults to `rawBody`. */
    sensitiveRawBody?: string
    headers: Readonly<Record<string, string>>
    details?: ErrorDetails | null
    retryAfter?: number | null
    rateLimit?: RateLimit | null
    slip?: BankSlip | TrueWalletSlip | null
}

/**
 * The API answered with an error status. Subclasses tell the kind of error; `code` holds the
 * exact API error code (for example `SLIP_NOT_FOUND` on v2, `slip_not_found` on v1).
 *
 * If the server echoed your API key back, the SDK has replaced it with `[REDACTED]` in the
 * message, `rawBody`, `headers` and `details`, and `Authorization` header values are always
 * `[REDACTED]`. Only {@link sensitiveRawBody} returns the body as received.
 */
export class ApiError extends ThunderError {
    /** HTTP status code. */
    readonly status: number
    /** API error code, or null when the body was not JSON. */
    readonly code: string | null
    /** `x-request-id` header, else `cf-ray`, else null. */
    readonly requestId: string | null
    /** The response body, with the API key replaced by `[REDACTED]` if the server echoed it. */
    readonly rawBody: string
    /** Response headers with lower-case names, redacted like `rawBody`. */
    readonly headers: Readonly<Record<string, string>>
    /** v1 `details`, when present. */
    readonly details: ErrorDetails | null
    /** Seconds from the `Retry-After` header, when present. */
    readonly retryAfter: number | null
    /** Rate limit counters, when the API sent them. */
    readonly rateLimit: RateLimit | null
    readonly #sensitiveRawBody: string

    constructor(init: ApiErrorInit) {
        super(init.message)
        this.status = init.status
        this.code = init.code
        this.requestId = init.requestId
        this.rawBody = init.rawBody
        this.#sensitiveRawBody = init.sensitiveRawBody ?? init.rawBody
        this.headers = init.headers
        this.details = init.details ?? null
        this.retryAfter = init.retryAfter ?? null
        this.rateLimit = init.rateLimit ?? null
    }

    /**
     * The response body exactly as received, without redaction. It can contain your API key if
     * the server echoed the request: treat it as a secret and never log it.
     */
    sensitiveRawBody(): string {
        return this.#sensitiveRawBody
    }

    override toString(): string {
        return `${this.name}: [${this.status}${this.code ? ` ${this.code}` : ''}] ${this.message}`
    }

    /** The redacted fields, for `JSON.stringify(error)`. */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            status: this.status,
            code: this.code,
            requestId: this.requestId,
            details: this.details,
            retryAfter: this.retryAfter,
            rateLimit: this.rateLimit,
            headers: this.headers,
            rawBody: this.rawBody,
        }
    }
}

/** The API key is missing, malformed or unknown. */
export class AuthenticationError extends ApiError {}
/** The key is valid but the account, branch or IP may not call this endpoint. */
export class PermissionDeniedError extends ApiError {}
/** The service quota is used up. Nothing was charged. */
export class QuotaExceededError extends PermissionDeniedError {}
/** The API rejected the request body, query or parameters. */
export class InvalidRequestError extends ApiError {}
/** The image is missing, too large, not an image, or not a slip of the right kind. */
export class InvalidImageError extends InvalidRequestError {}
/** An image URL or callback URL was refused. */
export class InvalidUrlError extends InvalidRequestError {}
/** v1 only: the slip was verified before. `slip` holds the original slip. */
export class DuplicateSlipError extends InvalidRequestError {
    /** The original slip the API sent with the error. */
    readonly slip: BankSlip | TrueWalletSlip | null

    constructor(init: ApiErrorInit) {
        super(init)
        this.slip = init.slip ?? null
    }
}
/** The resource does not exist or is not visible to this branch. */
export class NotFoundError extends ApiError {}
/** The bank or wallet could not find the slip, or the image has no QR code. */
export class SlipNotFoundError extends NotFoundError {}
/** Bangkok Bank slip from the last few minutes. Try again later. */
export class SlipPendingError extends NotFoundError {}
/** The request conflicts with existing data, such as a duplicate bank account. */
export class ConflictError extends ApiError {}
/** Too many requests. `retryAfter` says how long to wait. */
export class RateLimitError extends ApiError {}
/** 5xx from the API or an upstream bank service. */
export class ServerError extends ApiError {}
/** 503: a dependency is briefly unavailable. Usually sent with `retryAfter`. */
export class ServiceUnavailableError extends ServerError {}

/** No HTTP response arrived (DNS, connect, TLS, connection reset). */
export class NetworkError extends ThunderError {}
/** The client timeout fired before a response arrived. */
export class RequestTimeoutError extends NetworkError {}

/** Codes of {@link InputError}. */
export type InputErrorCode =
    | 'FILE_TOO_LARGE'
    | 'UNSUPPORTED_FILE_TYPE'
    | 'EMPTY_FILE'
    | 'FILE_NOT_READABLE'
    | 'BATCH_TOO_LARGE'
    | 'EMPTY_BATCH'
    | 'INVALID_ARGUMENT'

/** The SDK rejected an argument before sending anything. */
export class InputError extends ThunderError {
    /** Why the argument was rejected. */
    readonly code: InputErrorCode

    constructor(code: InputErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
        this.code = code
    }

    override toString(): string {
        return `${this.name}: [${this.code}] ${this.message}`
    }
}

/** A webhook signature header is missing, malformed or does not match the raw body. */
export class WebhookSignatureError extends ThunderError {}

/** `waitForJob` gave up before the job finished. */
export class JobWaitTimeoutError extends ThunderError {
    /** The last job state seen. */
    readonly lastJob: Job | null

    constructor(message: string, lastJob: Job | null) {
        super(message)
        this.lastJob = lastJob
    }
}

/** `submitBankMany` failed part way. Batches already accepted keep running. */
export class BatchSubmitError extends ThunderError {
    /** Batches the API accepted before the failure. */
    readonly submitted: readonly BatchSubmission[]
    /** 0-based index of the chunk of 100 that failed. */
    readonly failedChunk: number

    constructor(submitted: readonly BatchSubmission[], failedChunk: number, cause: unknown) {
        super(
            `batch chunk ${failedChunk} failed after ${submitted.length} accepted: ${String(
                cause instanceof Error ? cause.message : cause,
            )}`,
            { cause },
        )
        this.submitted = submitted
        this.failedChunk = failedChunk
    }
}

const apiErrorClasses = {
    ApiError,
    AuthenticationError,
    PermissionDeniedError,
    QuotaExceededError,
    InvalidRequestError,
    InvalidImageError,
    InvalidUrlError,
    DuplicateSlipError,
    NotFoundError,
    SlipNotFoundError,
    SlipPendingError,
    ConflictError,
    RateLimitError,
    ServerError,
    ServiceUnavailableError,
}

/** Names of the error classes an HTTP error can map to. */
export type ApiErrorClassName = keyof typeof apiErrorClasses

export function apiErrorClass(name: ApiErrorClassName): typeof ApiError {
    return apiErrorClasses[name]
}
