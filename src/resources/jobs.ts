import { call, defined, requestOptions, requireString } from '../core/call.js'
import {
    BatchSubmitError,
    InputError,
    JobWaitTimeoutError,
    RequestTimeoutError,
} from '../core/errors.js'
import type { RequestOptions, Transport } from '../core/http.js'
import type { WithMeta } from '../core/meta.js'
import type { BatchSubmission, Job, JobSubmission } from '../models.js'
import { type VerifyOptions, verifyFields } from './verify.js'

/** Most slips one batch call accepts. {@link Jobs.submitBankMany} splits larger lists. */
export const BATCH_MAX = 100

/** Options of an async verify call. */
export interface AsyncVerifyOptions extends VerifyOptions {
    /**
     * https URL the result webhook is posted to, up to 255 characters. Required unless the
     * branch has a default webhook URL.
     */
    callbackUrl?: string
}

/** One slip of a batch. */
export interface BatchSlip extends VerifyOptions {
    /** QR payload string. */
    payload: string
}

export interface BatchOptions extends RequestOptions {
    /** https URL every job's webhook is posted to. */
    callbackUrl?: string
}

export interface WaitForJobOptions {
    /** Time between polls in milliseconds. Default 2000, minimum 500. */
    interval?: number
    /**
     * Give up after this many milliseconds. Default 600000 (10 minutes). One deadline for the
     * whole wait: requests still running at the deadline are cancelled, and an answer that
     * arrives after it is not returned.
     */
    timeout?: number
    /** Stops waiting; the call then rejects with the signal's reason. */
    signal?: AbortSignal
}

const SLIP_KEYS = ['payload', 'remark', 'matchAccount', 'matchAmount', 'checkDuplicate'] as const

/**
 * Async bank slip verification (`client.jobs`). Submits are billed when the job verifies the
 * slip; like the sync calls they are never retried once the request may have arrived.
 */
export class Jobs {
    readonly #t: Transport
    readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>
    readonly #timeout: number

    constructor(transport: Transport) {
        this.#t = transport
        this.#sleep = transport.config.sleep
        this.#timeout = transport.config.timeout
    }

    /** Queues one QR payload. The result arrives on the webhook or through {@link get}. */
    async submitBank(
        payload: string,
        options?: AsyncVerifyOptions & RequestOptions,
    ): Promise<WithMeta<JobSubmission>> {
        requireString(payload, 'payload')
        const json: Record<string, unknown> = { payload, ...verifyFields(options) }
        if (options?.callbackUrl !== undefined) json.callbackUrl = options.callbackUrl
        return call(this.#t, 'JobSubmission', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/bank/async',
            json,
            retry: 'billed',
        })
    }

    /** Queues 1 to 100 payloads in one call. Each slip becomes its own job. */
    async submitBankBatch(
        slips: readonly BatchSlip[],
        options?: BatchOptions,
    ): Promise<WithMeta<BatchSubmission>> {
        if (!Array.isArray(slips) || slips.length === 0) {
            throw new InputError('EMPTY_BATCH', 'slips must contain at least one slip')
        }
        if (slips.length > BATCH_MAX) {
            throw new InputError(
                'BATCH_TOO_LARGE',
                `a batch takes at most ${BATCH_MAX} slips; use submitBankMany for more`,
            )
        }
        for (const slip of slips) requireString(slip?.payload, 'slip payload')
        const json: Record<string, unknown> = {}
        if (options?.callbackUrl !== undefined) json.callbackUrl = options.callbackUrl
        json.slips = slips.map((slip) => defined(slip, SLIP_KEYS))
        return call(this.#t, 'BatchSubmission', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/bank/batch',
            json,
            retry: 'billed',
        })
    }

    /**
     * Queues any number of payloads, 100 per call, one call after another. Quota is the same as
     * one big batch: each slip is billed when its job verifies it. If a call fails, the batches
     * already accepted keep running and {@link BatchSubmitError} lists them.
     */
    async submitBankMany(
        slips: readonly BatchSlip[],
        options?: BatchOptions,
    ): Promise<BatchSubmission[]> {
        if (!Array.isArray(slips) || slips.length === 0) {
            throw new InputError('EMPTY_BATCH', 'slips must contain at least one slip')
        }
        const submitted: BatchSubmission[] = []
        for (let start = 0, chunk = 0; start < slips.length; start += BATCH_MAX, chunk++) {
            try {
                submitted.push(
                    await this.submitBankBatch(slips.slice(start, start + BATCH_MAX), options),
                )
            } catch (cause) {
                throw new BatchSubmitError(submitted, chunk, cause)
            }
        }
        return submitted
    }

    /** Gets a job by id. */
    async get(jobId: string, options?: RequestOptions): Promise<WithMeta<Job>> {
        requireString(jobId, 'jobId')
        return call(this.#t, 'Job', {
            ...requestOptions(options),
            api: 'v2',
            method: 'GET',
            path: `/verify/bank/jobs/${encodeURIComponent(jobId)}`,
            retry: 'safe',
        })
    }

    /**
     * Polls a job until its status is `done` or `failed` and returns it. A failed job is
     * returned, not thrown. `timeout` is one deadline for the whole wait: each
     * poll and its retries get only the time left, a request still running at the deadline is
     * cancelled, and an answer that arrives after the deadline is not returned. Then it throws
     * {@link JobWaitTimeoutError} with the last job received in time. Aborting `signal` rejects
     * with the signal's reason instead.
     */
    async waitForJob(jobId: string, options?: WaitForJobOptions): Promise<WithMeta<Job>> {
        requireString(jobId, 'jobId')
        const interval = Math.max(500, options?.interval ?? 2000)
        const timeout = options?.timeout ?? 600_000
        if (!Number.isFinite(timeout) || timeout < 0) {
            throw new InputError('INVALID_ARGUMENT', 'timeout must be a number >= 0')
        }
        const caller = options?.signal
        caller?.throwIfAborted()
        const deadline = Date.now() + timeout
        let last: WithMeta<Job> | null = null
        const expired = () =>
            new JobWaitTimeoutError(
                `job ${jobId} ${last ? `still ${last.status}` : 'not read'} after ${timeout} ms`,
                last,
            )

        // One signal for every request and wait: aborted by the caller or at the deadline.
        const budget = new AbortController()
        const reason = new Error('waitForJob deadline')
        const timer = setTimeout(() => budget.abort(reason), timeout)
        const onAbort = () => budget.abort(caller?.reason)
        caller?.addEventListener('abort', onAbort, { once: true })
        const deadlinePassed = () => budget.signal.reason === reason && !caller?.aborted
        // Settles when the budget is aborted, so a custom fetch or sleep that ignores the signal
        // cannot hold the call past the deadline.
        const stopped = new Promise<never>((_, reject) => {
            budget.signal.addEventListener('abort', () => reject(budget.signal.reason), {
                once: true,
            })
        })
        stopped.catch(() => {})
        try {
            while (true) {
                const left = deadline - Date.now()
                if (left <= 0) throw expired()
                // The attempt timeout is cut to the time left, so its timeout is the deadline too.
                const capped = left < this.#timeout
                let job: WithMeta<Job>
                try {
                    job = await Promise.race([
                        this.get(jobId, {
                            signal: budget.signal,
                            timeout: Math.max(1, Math.min(this.#timeout, left)),
                        }),
                        stopped,
                    ])
                } catch (error) {
                    if (deadlinePassed()) throw expired()
                    if (capped && error instanceof RequestTimeoutError && !caller?.aborted) {
                        throw expired()
                    }
                    throw error
                }
                // A request that ignored cancellation can still answer late: do not return it.
                if (Date.now() >= deadline) throw expired()
                last = job
                if (job.status === 'done' || job.status === 'failed') return job
                const wait = Math.min(interval, deadline - Date.now())
                if (wait <= 0) throw expired()
                try {
                    await Promise.race([this.#sleep(wait, budget.signal), stopped])
                } catch (error) {
                    if (deadlinePassed()) throw expired()
                    throw error
                }
            }
        } finally {
            clearTimeout(timer)
            caller?.removeEventListener('abort', onAbort)
        }
    }
}
