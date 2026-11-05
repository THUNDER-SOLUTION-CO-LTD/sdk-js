import { describe, expect, test } from 'bun:test'
import type {
    AccountType,
    CreateBankAccountParams,
    ListBankAccountsParams,
    QrRequest,
    QrType,
    UpdateBankAccountParams,
} from '../../src/index.ts'
import { bodyOf, mockClient, ok } from './helpers.ts'

const account = {
    id: 7,
    bankCode: '004',
    bankNumber: '1234567890',
    nameTh: 'บริษัท ตัวอย่าง จำกัด',
    nameEn: 'EXAMPLE CO., LTD.',
    type: 'JURISTIC',
    extraVerify: null,
    matchMode: null,
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    deletedAt: null,
}

describe('request types accept only the values the API accepts', () => {
    test('receiving account type is NATURAL or JURISTIC on create, update and list', async () => {
        const { client, sent } = mockClient((s) =>
            s.url.pathname.endsWith('/bank-accounts') && s.init.method === 'GET'
                ? ok({ items: [account], total: 1, page: 1, limit: 20 })
                : ok(account),
        )
        const types: AccountType[] = ['NATURAL', 'JURISTIC']
        const create: CreateBankAccountParams = {
            bankCode: '004',
            bankNumber: '1234567890',
            nameTh: 'บริษัท ตัวอย่าง จำกัด',
            nameEn: 'EXAMPLE CO., LTD.',
            type: 'JURISTIC',
        }
        const update: UpdateBankAccountParams = { type: 'NATURAL' }
        const list: ListBankAccountsParams = { type: 'JURISTIC' }
        await client.bankAccounts.create(create)
        await client.bankAccounts.update(7, update)
        await client.bankAccounts.list(list)
        expect(types).toEqual(['NATURAL', 'JURISTIC'])
        const [created, updated, listed] = sent.map((s) => ({ body: bodyOf(s), url: s.url }))
        expect(created?.body).toMatchObject({ type: 'JURISTIC' })
        expect(updated?.body).toEqual({ type: 'NATURAL' })
        expect(listed?.url.searchParams.get('type')).toBe('JURISTIC')
    })

    test('BANK and other strings do not type check as a receiving account type', () => {
        const create: CreateBankAccountParams = {
            bankCode: '004',
            bankNumber: '1234567890',
            nameTh: 'บริษัท ตัวอย่าง จำกัด',
            nameEn: 'EXAMPLE CO., LTD.',
            // @ts-expect-error a receiving account type is NATURAL or JURISTIC
            type: 'BANK',
        }
        // @ts-expect-error a receiving account type is NATURAL or JURISTIC
        const update: UpdateBankAccountParams = { type: 'BANK' }
        // @ts-expect-error a receiving account type is NATURAL or JURISTIC
        const list: ListBankAccountsParams = { type: 'bank' }
        // @ts-expect-error a receiving account type is NATURAL or JURISTIC
        const type: AccountType = 'PERSONAL'
        expect([create.type, update.type, list.type, type]).toHaveLength(4)
    })

    test('QR type is one of the five types the API accepts', () => {
        const types: QrType[] = ['PROMPTPAY', 'BILL_PAYMENT', 'KSHOP', 'MAE_MANEE', 'TUNGNGERN']
        // @ts-expect-error the API has no K_SHOP type, it is KSHOP
        const misspelled: QrType = 'K_SHOP'
        // @ts-expect-error the API has no QR type BANK
        const request: QrRequest = { type: 'BANK', billerId: '010555123456701' }
        expect([...types, misspelled, request.type]).toHaveLength(7)
    })
})
