import { call, defined, requestOptions, requireId } from '../core/call.js'
import type { RequestOptions, Transport } from '../core/http.js'
import type { WithMeta } from '../core/meta.js'
import type {
    BankAccount,
    BankAccountPage,
    BankAccountType,
    LinkResult,
    MatchMode,
    Open,
    UnlinkResult,
} from '../models.js'

/** The receiving account types a request may send: `NATURAL` or `JURISTIC`. */
export type AccountType = (typeof BankAccountType)[keyof typeof BankAccountType]
type AccountMatchMode = Open<(typeof MatchMode)[keyof typeof MatchMode]>

/** Filters and paging for the list calls. */
export interface ListBankAccountsParams {
    /** `NATURAL` or `JURISTIC`. */
    type?: AccountType
    /** Only accounts at this bank code. */
    bankCode?: string
    /** Page number, from 1. */
    page?: number
    /** Page size, 1 to 100. The API default is 20. */
    limit?: number
}

export interface CreateBankAccountParams {
    /** A code from `client.banks.list()`. */
    bankCode: string
    bankNumber: string
    nameTh: string
    nameEn: string
    type: AccountType
    /** One of the bank's `extraVerify[].value` options. */
    extraVerify?: string
    /** PromptPay accounts only: `NAME`, `NUMBER` or `NAME_NUMBER`. */
    matchMode?: AccountMatchMode
}

export interface UpdateBankAccountParams {
    bankCode?: string
    bankNumber?: string
    nameTh?: string
    nameEn?: string
    type?: AccountType
    /** Leave out to keep, a string to set, `null` to clear. */
    extraVerify?: string | null
    matchMode?: AccountMatchMode
}

const CREATE_KEYS = [
    'bankCode',
    'bankNumber',
    'nameTh',
    'nameEn',
    'type',
    'extraVerify',
    'matchMode',
] as const

function listQuery(params: ListBankAccountsParams | undefined): Record<string, string | undefined> {
    return {
        type: params?.type,
        bankCode: params?.bankCode,
        page: params?.page === undefined ? undefined : String(params.page),
        limit: params?.limit === undefined ? undefined : String(params.limit),
    }
}

/** Receiving bank accounts used by `matchAccount` (`client.bankAccounts`). */
export class BankAccounts {
    readonly #t: Transport

    constructor(transport: Transport) {
        this.#t = transport
    }

    /** One page of the accounts linked to this branch. */
    async list(
        params?: ListBankAccountsParams,
        options?: RequestOptions,
    ): Promise<WithMeta<BankAccountPage>> {
        return call(this.#t, 'BankAccountPage', {
            ...requestOptions(options),
            api: 'v2',
            method: 'GET',
            path: '/bank-accounts',
            query: listQuery(params),
            retry: 'safe',
        })
    }

    /** One page of every active account of the service, linked to this branch or not. */
    async listAll(
        params?: ListBankAccountsParams,
        options?: RequestOptions,
    ): Promise<WithMeta<BankAccountPage>> {
        return call(this.#t, 'BankAccountPage', {
            ...requestOptions(options),
            api: 'v2',
            method: 'GET',
            path: '/bank-accounts/all',
            query: listQuery(params),
            retry: 'safe',
        })
    }

    /** Gets one account linked to this branch. */
    async get(id: number, options?: RequestOptions): Promise<WithMeta<BankAccount>> {
        requireId(id)
        return call(this.#t, 'BankAccount', {
            ...requestOptions(options),
            api: 'v2',
            method: 'GET',
            path: `/bank-accounts/${id}`,
            retry: 'safe',
        })
    }

    /** Registers an account on the service and links it to this branch. */
    async create(
        params: CreateBankAccountParams,
        options?: RequestOptions,
    ): Promise<WithMeta<BankAccount>> {
        return call(this.#t, 'BankAccount', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: '/bank-accounts',
            json: defined(params, CREATE_KEYS),
            retry: 'write',
        })
    }

    /** Changes the fields you pass. Pass `extraVerify: null` to clear it. */
    async update(
        id: number,
        params: UpdateBankAccountParams,
        options?: RequestOptions,
    ): Promise<WithMeta<BankAccount>> {
        requireId(id)
        return call(this.#t, 'BankAccount', {
            ...requestOptions(options),
            api: 'v2',
            method: 'PATCH',
            path: `/bank-accounts/${id}`,
            json: defined(params, CREATE_KEYS),
            retry: 'write',
        })
    }

    /** Links an existing service account to this branch. Linking twice is fine. */
    async link(id: number, options?: RequestOptions): Promise<WithMeta<LinkResult>> {
        requireId(id)
        return call(this.#t, 'LinkResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'POST',
            path: `/bank-accounts/${id}/link`,
            retry: 'safe',
        })
    }

    /** Unlinks an account from this branch. The account stays on the service. */
    async unlink(id: number, options?: RequestOptions): Promise<WithMeta<UnlinkResult>> {
        requireId(id)
        return call(this.#t, 'UnlinkResult', {
            ...requestOptions(options),
            api: 'v2',
            method: 'DELETE',
            path: `/bank-accounts/${id}/link`,
            retry: 'write',
        })
    }

    /** Walks every page of {@link list}, one request per page (100 accounts by default). */
    iterate(
        params?: ListBankAccountsParams,
        options?: RequestOptions,
    ): AsyncGenerator<BankAccount> {
        return this.#walk((p) => this.list(p, options), params)
    }

    /** Walks every page of {@link listAll}. */
    iterateAll(
        params?: ListBankAccountsParams,
        options?: RequestOptions,
    ): AsyncGenerator<BankAccount> {
        return this.#walk((p) => this.listAll(p, options), params)
    }

    async *#walk(
        fetchPage: (params: ListBankAccountsParams) => Promise<BankAccountPage>,
        params: ListBankAccountsParams | undefined,
    ): AsyncGenerator<BankAccount> {
        let page = params?.page ?? 1
        const limit = params?.limit ?? 100
        while (true) {
            const result = await fetchPage({ ...params, page, limit })
            yield* result.items
            if (result.items.length === 0 || page * limit >= result.total) return
            page++
        }
    }
}
