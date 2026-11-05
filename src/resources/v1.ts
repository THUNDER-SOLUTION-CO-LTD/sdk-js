import { call, imageForm, requestOptions, requireString } from '../core/call.js'
import { InputError } from '../core/errors.js'
import { type FileInput, prepareFile } from '../core/files.js'
import type { RequestOptions, Transport } from '../core/http.js'
import type { WithMeta } from '../core/meta.js'
import type { BankSlip, QrCode, TrueWalletSlip, V1Me } from '../models.js'

/** Options of the v1 verify calls. */
export interface V1VerifyOptions extends RequestOptions {
    /**
     * Reject a slip this application verified before with `DuplicateSlipError`, whose `slip`
     * is the original slip. v1 does not charge for a duplicate.
     */
    checkDuplicate?: boolean
}

/** Shared fields of every QR request. */
interface QrBase {
    /** Amount in baht. Leave out for a QR the payer fills in. */
    amount?: number
}

/** PromptPay QR: exactly one of `msisdn`, `natId`, `eWalletId`, `billerId`. */
export interface PromptPayQr extends QrBase {
    type: 'PROMPTPAY'
    msisdn?: string
    natId?: string
    eWalletId?: string
    /** Biller id (bill payment). `ref1` and `ref2` are only allowed with it. */
    billerId?: string
    /** Reference 1, with `billerId` only. Optional: leave it out for a QR without Ref1. */
    ref1?: string
    /** Reference 2, with `billerId` and `ref1` only. */
    ref2?: string
}

/** Bill payment QR, the older name for PromptPay with `billerId`. */
export interface BillPaymentQr extends QrBase {
    type: 'BILL_PAYMENT'
    billerId: string
    /** Reference 1. Optional: leave it out for a QR without Ref1. */
    ref1?: string
    /** Reference 2, only together with `ref1`. */
    ref2?: string
}

/** K SHOP or Mae Manee merchant QR. */
export interface MerchantQr extends QrBase {
    type: 'KSHOP' | 'MAE_MANEE'
    /**
     * The shop id. K SHOP: `KB` and 12 digits (the API accepts any case and removes a leading
     * `KPS004`). Mae Manee: 15 digits.
     */
    ref1: string
}

/** Thung Ngern merchant QR. */
export interface TungNgernQr extends QrBase {
    type: 'TUNGNGERN'
    /** Merchant code, 1 to 20 letters or digits. */
    ref1: string
    /**
     * The English shop name shown in the Tung Ngern app. The API keeps A-Z and 0-9, uppercased
     * and cut to 20 characters, and rejects a name with none of them (a Thai-only name).
     */
    merchantName: string
}

/** Body of `v1.generateQr`. The API checks the field combinations. */
export type QrRequest = PromptPayQr | BillPaymentQr | MerchantQr | TungNgernQr

/** The QR types `v1.generateQr` accepts. */
export type QrType = QrRequest['type']

/** A QR code from `generateQr`, with a helper that decodes the PNG. */
export type QrCodeResult = WithMeta<QrCode> & {
    /** The PNG image as bytes. */
    imageBytes(): Uint8Array
}

function decodeBase64(text: string): Uint8Array {
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

function boolString(value: boolean): string {
    return value ? 'true' : 'false'
}

/** The v1 API (`client.v1`). Verify calls are billed; `generateQr` is free. */
export class V1 {
    readonly #t: Transport

    constructor(transport: Transport) {
        this.#t = transport
    }

    /** Quota and credit of the application. */
    async getMe(options?: RequestOptions): Promise<WithMeta<V1Me>> {
        return call(this.#t, 'V1Me', {
            ...requestOptions(options),
            api: 'v1',
            method: 'GET',
            path: '/me',
            retry: 'safe',
        })
    }

    /** Verifies a bank slip from its QR payload (`GET /verify`). */
    async verifyBankByPayload(
        payload: string,
        options?: V1VerifyOptions,
    ): Promise<WithMeta<BankSlip>> {
        requireString(payload, 'payload')
        return call(this.#t, 'BankSlip', {
            ...requestOptions(options),
            api: 'v1',
            method: 'GET',
            path: '/verify',
            query: {
                payload,
                checkDuplicate:
                    options?.checkDuplicate === undefined
                        ? undefined
                        : boolString(options.checkDuplicate),
            },
            retry: 'billed',
            duplicateSlip: 'BankSlip',
        })
    }

    /** Verifies a bank slip image (multipart field `file`). */
    async verifyBankByImage(
        file: FileInput,
        options?: V1VerifyOptions,
    ): Promise<WithMeta<BankSlip>> {
        const prepared = await prepareFile(file)
        const fields: Record<string, string> = {}
        if (options?.checkDuplicate !== undefined) {
            fields.checkDuplicate = boolString(options.checkDuplicate)
        }
        return call(this.#t, 'BankSlip', {
            ...requestOptions(options),
            api: 'v1',
            method: 'POST',
            path: '/verify',
            form: imageForm('file', prepared, fields),
            retry: 'billed',
            duplicateSlip: 'BankSlip',
        })
    }

    /** Verifies a base64 bank slip image. Sent as the JSON field `image`. */
    async verifyBankByBase64(
        base64: string,
        options?: V1VerifyOptions,
    ): Promise<WithMeta<BankSlip>> {
        requireString(base64, 'base64')
        const json: Record<string, unknown> = { image: base64 }
        if (options?.checkDuplicate !== undefined) json.checkDuplicate = options.checkDuplicate
        return call(this.#t, 'BankSlip', {
            ...requestOptions(options),
            api: 'v1',
            method: 'POST',
            path: '/verify',
            json,
            retry: 'billed',
            duplicateSlip: 'BankSlip',
        })
    }

    /** Verifies a bank slip image the API downloads from a public URL. */
    async verifyBankByUrl(url: string, options?: V1VerifyOptions): Promise<WithMeta<BankSlip>> {
        requireString(url, 'url')
        const json: Record<string, unknown> = { url }
        if (options?.checkDuplicate !== undefined) json.checkDuplicate = options.checkDuplicate
        return call(this.#t, 'BankSlip', {
            ...requestOptions(options),
            api: 'v1',
            method: 'POST',
            path: '/verify',
            json,
            retry: 'billed',
            duplicateSlip: 'BankSlip',
        })
    }

    /** Verifies a TrueMoney Wallet slip image. */
    async verifyTruemoneyByImage(
        file: FileInput,
        options?: V1VerifyOptions,
    ): Promise<WithMeta<TrueWalletSlip>> {
        const prepared = await prepareFile(file)
        const fields: Record<string, string> = {}
        if (options?.checkDuplicate !== undefined) {
            fields.checkDuplicate = boolString(options.checkDuplicate)
        }
        return call(this.#t, 'TrueWalletSlip', {
            ...requestOptions(options),
            api: 'v1',
            method: 'POST',
            path: '/verify/truewallet',
            form: imageForm('file', prepared, fields),
            retry: 'billed',
            duplicateSlip: 'TrueWalletSlip',
        })
    }

    /** Generates a payment QR image. No quota is used. */
    async generateQr(request: QrRequest, options?: RequestOptions): Promise<QrCodeResult> {
        if (!request || typeof request !== 'object') {
            throw new InputError('INVALID_ARGUMENT', 'request must be an object with a type')
        }
        const result = await call(this.#t, 'QrCode', {
            ...requestOptions(options),
            api: 'v1',
            method: 'POST',
            path: '/qr/generate',
            json: request,
            retry: 'safe',
        })
        Object.defineProperty(result, 'imageBytes', {
            value: () => decodeBase64(result.image),
            enumerable: false,
        })
        return result as QrCodeResult
    }
}
