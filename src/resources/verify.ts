import { call, defined, imageForm, requestOptions, requireString } from '../core/call.js'
import { type FileInput, prepareFile } from '../core/files.js'
import type { RequestOptions, Transport } from '../core/http.js'
import type { WithMeta } from '../core/meta.js'
import type { BankSlipResult, TrueWalletResult } from '../models.js'

/** Options of every v2 verify call. Options you leave out are not sent. */
export interface VerifyOptions {
    /** Your own note, 1 to 255 characters. Echoed back as `remark`. */
    remark?: string
    /** Match the receiver against your registered bank accounts. Adds `matchedAccount`. */
    matchAccount?: boolean
    /** Expected amount. Adds `amountInOrder` and `isAmountMatched`. */
    matchAmount?: number
    /** Check whether this branch verified the slip before. Adds `isDuplicate`. */
    checkDuplicate?: boolean
}

export type VerifyCallOptions = VerifyOptions & RequestOptions

const OPTION_KEYS = ['remark', 'matchAccount', 'matchAmount', 'checkDuplicate'] as const

export function verifyFields(options: VerifyOptions | undefined): VerifyOptions {
    return defined(options, OPTION_KEYS)
}

/**
 * v2 slip verification (`client.verify`). Every call here is billed: it can spend quota, so
 * the SDK only retries it when the request never reached the API (or on 429).
 */
export class Verify {
    readonly #t: Transport

    constructor(transport: Transport) {
        this.#t = transport
    }

    /** Verifies a bank slip from its QR payload string. */
    async bankByPayload(
        payload: string,
        options?: VerifyCallOptions,
    ): Promise<WithMeta<BankSlipResult>> {
        requireString(payload, 'payload')
        return call(this.#t, 'BankSlipResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/bank',
            json: { payload, ...verifyFields(options) },
            retry: 'billed',
        })
    }

    /** Verifies a bank slip image (JPEG, PNG, GIF or WebP, up to 4 MB). */
    async bankByImage(
        file: FileInput,
        options?: VerifyCallOptions,
    ): Promise<WithMeta<BankSlipResult>> {
        const prepared = await prepareFile(file)
        return call(this.#t, 'BankSlipResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/bank',
            form: imageForm(
                'image',
                prepared,
                verifyFields(options) as Record<string, string | number | boolean>,
            ),
            retry: 'billed',
        })
    }

    /** Verifies a base64 bank slip image. A `data:image/...;base64,` prefix is fine. */
    async bankByBase64(
        base64: string,
        options?: VerifyCallOptions,
    ): Promise<WithMeta<BankSlipResult>> {
        requireString(base64, 'base64')
        return call(this.#t, 'BankSlipResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/bank',
            json: { base64, ...verifyFields(options) },
            retry: 'billed',
        })
    }

    /** Verifies a bank slip image the API downloads from a public http(s) URL. */
    async bankByUrl(url: string, options?: VerifyCallOptions): Promise<WithMeta<BankSlipResult>> {
        requireString(url, 'url')
        return call(this.#t, 'BankSlipResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/bank',
            json: { url, ...verifyFields(options) },
            retry: 'billed',
        })
    }

    /** Verifies a TrueMoney Wallet slip image. */
    async truewalletByImage(
        file: FileInput,
        options?: VerifyCallOptions,
    ): Promise<WithMeta<TrueWalletResult>> {
        const prepared = await prepareFile(file)
        return call(this.#t, 'TrueWalletResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/truewallet',
            form: imageForm(
                'image',
                prepared,
                verifyFields(options) as Record<string, string | number | boolean>,
            ),
            retry: 'billed',
        })
    }

    /** Verifies a base64 TrueMoney Wallet slip image. */
    async truewalletByBase64(
        base64: string,
        options?: VerifyCallOptions,
    ): Promise<WithMeta<TrueWalletResult>> {
        requireString(base64, 'base64')
        return call(this.#t, 'TrueWalletResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/truewallet',
            json: { base64, ...verifyFields(options) },
            retry: 'billed',
        })
    }

    /** Verifies a TrueMoney Wallet slip image from a public URL (up to 255 characters). */
    async truewalletByUrl(
        url: string,
        options?: VerifyCallOptions,
    ): Promise<WithMeta<TrueWalletResult>> {
        requireString(url, 'url')
        return call(this.#t, 'TrueWalletResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/verify/truewallet',
            json: { url, ...verifyFields(options) },
            retry: 'billed',
        })
    }
}
