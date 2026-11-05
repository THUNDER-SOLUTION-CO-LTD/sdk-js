import { call, requestOptions } from '../core/call.js'
import type { RequestOptions, Transport } from '../core/http.js'
import type { WithMeta } from '../core/meta.js'
import type { BankList } from '../models.js'

/** Supported banks and receiving kinds (`client.banks`). */
export class Banks {
    readonly #t: Transport

    constructor(transport: Transport) {
        this.#t = transport
    }

    /** Lists the bank codes you can register accounts with, and their `extraVerify` options. */
    async list(options?: RequestOptions): Promise<WithMeta<BankList>> {
        return call(this.#t, 'BankList', {
            ...requestOptions(options),
            api: 'v2',
            method: 'GET',
            path: '/banks',
            retry: 'safe',
        })
    }
}
