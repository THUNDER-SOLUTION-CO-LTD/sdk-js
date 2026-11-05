import { call, requestOptions } from './core/call.js'
import { InputError } from './core/errors.js'
import { type FetchLike, type RequestOptions, Transport } from './core/http.js'
import type { WithMeta } from './core/meta.js'
import { loadFs, readEnv, runtimeToken, sleep } from './core/runtime.js'
import { settings } from './core/settings.js'
import type { Info } from './models.js'
import { BankAccounts } from './resources/bank-accounts.js'
import { Banks } from './resources/banks.js'
import { Jobs } from './resources/jobs.js'
import { V1 } from './resources/v1.js'
import { Verify } from './resources/verify.js'
import { VERSION } from './version.js'

/** Client settings. Every field is optional when the matching env variable is set. */
export interface ClientOptions {
    /** API key. Defaults to the API key env variable, then the file named by the key file env variable. */
    apiKey?: string
    /** v2 base URL. Defaults to the v2 base URL env variable, then the production host. */
    v2BaseUrl?: string
    /** v1 base URL. Defaults to the v1 base URL env variable, then the production host. */
    v1BaseUrl?: string
    /** Per-attempt timeout in milliseconds. Default 30000. */
    timeout?: number
    /** Retries after the first attempt, following each call's retry class. Default 2. */
    maxRetries?: number
    /** A fetch implementation, for proxies, custom agents or tests. Default: global fetch. */
    fetch?: FetchLike
    /** @internal Replaces the wait between retries and polls (tests). */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
    /** @internal Replaces Math.random for the backoff jitter (tests). */
    random?: () => number
}

function keyFromFile(path: string): () => Promise<string> {
    let cached: Promise<string> | undefined
    return () => {
        cached ??= (async () => {
            const fs = await loadFs()
            if (!fs) {
                throw new InputError(
                    'FILE_NOT_READABLE',
                    `${settings.env.apiKeyFile} needs a runtime with a file system`,
                )
            }
            let text: string
            try {
                text = new TextDecoder().decode(await fs.readFile(path))
            } catch (cause) {
                throw new InputError(
                    'FILE_NOT_READABLE',
                    `cannot read ${settings.env.apiKeyFile}`,
                    {
                        cause,
                    },
                )
            }
            const key = text.trim()
            if (!key)
                throw new InputError('INVALID_ARGUMENT', `${settings.env.apiKeyFile} is empty`)
            return key
        })()
        cached.catch(() => {
            cached = undefined
        })
        return cached
    }
}

function checkNumber(value: number | undefined, name: string, min: number): void {
    if (value !== undefined && (!Number.isFinite(value) || value < min)) {
        throw new InputError('INVALID_ARGUMENT', `${name} must be a number >= ${min}`)
    }
}

/**
 * API client. Create one and reuse it.
 *
 * ```ts
 * const client = new Client({ apiKey: 'YOUR_API_KEY' })
 * const result = await client.verify.bankByPayload(payload, { checkDuplicate: true })
 * ```
 */
export class Client {
    /** v2 slip verification. */
    readonly verify: Verify
    /** Supported banks. */
    readonly banks: Banks
    /** Registered receiving accounts. */
    readonly bankAccounts: BankAccounts
    /** Async verification jobs. */
    readonly jobs: Jobs
    /** The v1 API. */
    readonly v1: V1
    /** v2 base URL in use. */
    readonly v2BaseUrl: string
    /** v1 base URL in use. */
    readonly v1BaseUrl: string
    /** Per-attempt timeout in milliseconds. */
    readonly timeout: number
    /** Retries after the first attempt. */
    readonly maxRetries: number
    readonly #transport: Transport

    constructor(options: ClientOptions = {}) {
        checkNumber(options.timeout, 'timeout', 1)
        checkNumber(options.maxRetries, 'maxRetries', 0)
        let apiKey: () => Promise<string>
        const key = options.apiKey ?? readEnv(settings.env.apiKey)
        if (key !== undefined) {
            if (typeof key !== 'string' || key.trim() === '') {
                throw new InputError('INVALID_ARGUMENT', 'apiKey must be a non-empty string')
            }
            const value = key.trim()
            apiKey = () => Promise.resolve(value)
        } else {
            const file = readEnv(settings.env.apiKeyFile)
            if (!file) {
                throw new InputError(
                    'INVALID_ARGUMENT',
                    `no API key: pass apiKey or set ${settings.env.apiKey} or ${settings.env.apiKeyFile}`,
                )
            }
            apiKey = keyFromFile(file)
        }
        if (!options.fetch && typeof globalThis.fetch !== 'function') {
            throw new InputError('INVALID_ARGUMENT', 'no fetch: pass options.fetch')
        }
        this.v2BaseUrl =
            options.v2BaseUrl ?? readEnv(settings.env.v2BaseUrl) ?? settings.baseUrls.v2
        this.v1BaseUrl =
            options.v1BaseUrl ?? readEnv(settings.env.v1BaseUrl) ?? settings.baseUrls.v1
        this.timeout = options.timeout ?? 30_000
        this.maxRetries = Math.floor(options.maxRetries ?? 2)
        this.#transport = new Transport({
            v1BaseUrl: this.v1BaseUrl,
            v2BaseUrl: this.v2BaseUrl,
            timeout: this.timeout,
            maxRetries: this.maxRetries,
            userAgent: `${settings.userAgentProduct}/${VERSION} ${runtimeToken()}`,
            fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
            sleep: options.sleep ?? sleep,
            random: options.random ?? Math.random,
            apiKey,
        })
        this.verify = new Verify(this.#transport)
        this.banks = new Banks(this.#transport)
        this.bankAccounts = new BankAccounts(this.#transport)
        this.jobs = new Jobs(this.#transport)
        this.v1 = new V1(this.#transport)
    }

    /** The User-Agent header this client sends. */
    get userAgent(): string {
        return this.#transport.config.userAgent
    }

    /** Application, branch, quota and account details of the API key. */
    async getInfo(options?: RequestOptions): Promise<WithMeta<Info>> {
        return call(this.#transport, 'Info', {
            ...requestOptions(options),
            api: 'v2',
            method: 'GET',
            path: '/info',
            retry: 'safe',
        })
    }

    toJSON(): Record<string, unknown> {
        return {
            v2BaseUrl: this.v2BaseUrl,
            v1BaseUrl: this.v1BaseUrl,
            timeout: this.timeout,
            maxRetries: this.maxRetries,
        }
    }

    toString(): string {
        return `Client(${this.v2BaseUrl})`
    }

    [Symbol.for('nodejs.util.inspect.custom')](): string {
        return `Client ${JSON.stringify(this.toJSON())}`
    }
}
