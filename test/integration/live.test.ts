// Integration tests against the live Thunder API. Run them with `bun run test:integration`.
//
// Every test is skipped unless an API key is set (the key is never printed):
//   THUNDER_API_KEY or THUNDER_API_KEY_FILE
// Optional:
//   THUNDER_V1_BASE_URL, THUNDER_V2_BASE_URL  another API host, such as a test environment
//   THUNDER_TEST_WRITE=1        also creates, updates, links and unlinks a test bank account. The
//                                account stays on the service, because the API cannot delete it.
//   THUNDER_TEST_PAYLOADS_FILE  two or more QR payloads, one per line, of slips this branch has
//                                already verified, so checkDuplicate calls use no quota
//   THUNDER_TEST_QR_DIR         qr-0.png and qr-1.png, QR images of the first two payloads
//   THUNDER_TEST_CALLBACK_URL   an https URL that accepts webhook posts, for the async job tests

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sdk from '../../src/index.ts'

const env = process.env
const hasKey = Boolean(env.THUNDER_API_KEY || env.THUNDER_API_KEY_FILE)
const write = env.THUNDER_TEST_WRITE === '1'
const callbackUrl = env.THUNDER_TEST_CALLBACK_URL ?? ''
const payloadFile = env.THUNDER_TEST_PAYLOADS_FILE
const qrDir = env.THUNDER_TEST_QR_DIR
const payloads =
    payloadFile && existsSync(payloadFile)
        ? readFileSync(payloadFile, 'utf8')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
        : []
const qr = (i: number) => (qrDir ? join(qrDir, `qr-${i}.png`) : '')
const haveSamples = payloads.length >= 2 && existsSync(qr(0)) && existsSync(qr(1))
const blank = fileURLToPath(new URL('../fixtures/files/blank.png', import.meta.url))
const blankBase64 = readFileSync(blank).toString('base64')
const PRIVATE_URL = 'http://10.0.0.1/slip.png'

const results: Array<{ endpoint: string; result: string; note: string }> = []
const record = (endpoint: string, result: 'pass' | 'skip', note = '') =>
    results.push({ endpoint, result, note })

afterAll(() => {
    if (results.length === 0) return
    const width = Math.max(...results.map((r) => r.endpoint.length))
    console.log('\nintegration results')
    for (const r of results) console.log(`${r.endpoint.padEnd(width)}  ${r.result}  ${r.note}`)
})

async function expectError<T extends abstract new (...args: never) => unknown>(
    promise: Promise<unknown>,
    ErrorClass: T,
): Promise<InstanceType<T>> {
    const error = await promise.then(
        () => undefined,
        (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ErrorClass)
    return error as InstanceType<T>
}

const live = hasKey ? describe : describe.skip
const writes = hasKey && write ? describe : describe.skip
const withSamples = hasKey && haveSamples ? describe : describe.skip
const withJobs = hasKey && haveSamples && callbackUrl ? describe : describe.skip

live('no slip needed', () => {
    // Built in beforeAll, which a skipped describe never runs, so a run without a key skips cleanly.
    let client: sdk.Client
    beforeAll(() => {
        client = new sdk.Client()
    })

    test('getInfo', async () => {
        const info = await client.getInfo()
        expect(typeof info.application.name).toBe('string')
        expect(info.meta.requestId).not.toBeNull()
        record('GET /info', 'pass')
    })

    test('banks.list', async () => {
        const banks = await client.banks.list()
        expect(banks.length).toBeGreaterThanOrEqual(18)
        expect(banks.find('004')?.shortCode).toBe('KBANK')
        record('GET /banks', 'pass', `${banks.length} entries`)
    })

    test('verify by URL: refused URLs', async () => {
        await expectError(client.verify.bankByUrl(PRIVATE_URL), sdk.InvalidUrlError)
        await expectError(
            client.verify.bankByUrl('ftp://example.com/slip.png'),
            sdk.InvalidUrlError,
        )
        record('POST /verify/bank (url)', 'pass', 'error paths only: private IP, ftp')
        await expectError(client.verify.truewalletByUrl(PRIVATE_URL), sdk.InvalidUrlError)
        record('POST /verify/truewallet (url)', 'pass', 'error path only: private IP')
        await expectError(client.v1.verifyBankByUrl(PRIVATE_URL), sdk.InvalidUrlError)
        record('v1 POST /verify (url)', 'pass', 'error path only: private IP')
    })

    test('TrueMoney Wallet image and base64: a blank image is refused', async () => {
        const image = await expectError(
            client.verify.truewalletByImage(blank),
            sdk.InvalidImageError,
        )
        await expectError(client.verify.truewalletByBase64(blankBase64), sdk.InvalidImageError)
        const v1 = await expectError(client.v1.verifyTruemoneyByImage(blank), sdk.InvalidImageError)
        record('POST /verify/truewallet (image)', 'pass', `error path: ${image.code}`)
        record('POST /verify/truewallet (base64)', 'pass', `error path: ${image.code}`)
        record('v1 POST /verify/truewallet', 'pass', `error path: ${v1.code}`)
    })

    test('v1 getMe and generateQr for every QR type', async () => {
        const me = await client.v1.getMe()
        expect(typeof me.usedQuota).toBe('number')
        record('v1 GET /me', 'pass')
        const requests: sdk.QrRequest[] = [
            { type: 'PROMPTPAY', msisdn: '0812345678', amount: 100.5 },
            { type: 'PROMPTPAY', natId: '1234567890121' },
            {
                type: 'PROMPTPAY',
                billerId: '010555123456701',
                ref1: 'INV001',
                ref2: 'C001',
                amount: 125.5,
            },
            { type: 'BILL_PAYMENT', billerId: '010555123456701', ref1: 'INV001' },
            { type: 'BILL_PAYMENT', billerId: '010555123456701', amount: 125.5 },
            { type: 'KSHOP', ref1: 'KB000001234567', amount: 250 },
            { type: 'MAE_MANEE', ref1: '014000123456789' },
            { type: 'TUNGNGERN', ref1: 'ORDER12345', merchantName: 'MY STORE', amount: 750 },
        ]
        for (const request of requests) {
            const code = await client.v1.generateQr(request)
            expect([...code.imageBytes().subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
            expect(code.payload.startsWith('0002')).toBe(true)
        }
        await expectError(client.v1.generateQr({ type: 'KSHOP' } as never), sdk.InvalidRequestError)
        record('v1 POST /qr/generate', 'pass', `${requests.length} QR kinds + invalid_request`)
    })
})

withSamples('slips this branch already verified', () => {
    // Built in beforeAll, which a skipped describe never runs, so a run without a key skips cleanly.
    let client: sdk.Client
    beforeAll(() => {
        client = new sdk.Client()
    })
    const [p0] = payloads as [string]

    test('v2 verify bank by payload, image and base64', async () => {
        const byPayload = await client.verify.bankByPayload(p0, {
            checkDuplicate: true,
            remark: 'sdk-js integration',
        })
        expect(byPayload.isDuplicate).toBe(true)
        expect(byPayload.remark).toBe('sdk-js integration')
        expect('matchedAccount' in byPayload).toBe(false)
        record('POST /verify/bank (payload)', 'pass', 'cached slip, isDuplicate true')
        const byImage = await client.verify.bankByImage(qr(0), { checkDuplicate: true })
        expect(byImage.rawSlip.transRef).toBe(byPayload.rawSlip.transRef)
        record('POST /verify/bank (image)', 'pass')
        const base64 = readFileSync(qr(1)).toString('base64')
        const byBase64 = await client.verify.bankByBase64(`data:image/png;base64,${base64}`, {
            checkDuplicate: true,
        })
        expect(byBase64.rawSlip.payload.length).toBeGreaterThan(0)
        record('POST /verify/bank (base64)', 'pass')
    })

    test('v1 verify bank by payload, image and base64', async () => {
        const slip = await client.v1.verifyBankByPayload(p0)
        expect(slip.transRef.length).toBeGreaterThan(0)
        const dup = await expectError(
            client.v1.verifyBankByPayload(p0, { checkDuplicate: true }),
            sdk.DuplicateSlipError,
        )
        expect((dup.slip as sdk.BankSlip).transRef).toBe(slip.transRef)
        record('v1 GET /verify (payload)', 'pass', 'plus duplicate_slip with typed slip')
        const byImage = await client.v1.verifyBankByImage(qr(0), { checkDuplicate: false })
        expect(byImage.transRef).toBe(slip.transRef)
        record('v1 POST /verify (image)', 'pass')
        const byBase64 = await client.v1.verifyBankByBase64(readFileSync(qr(1)).toString('base64'))
        expect(byBase64.transRef.length).toBeGreaterThan(0)
        record('v1 POST /verify (base64)', 'pass')
    })
})

writes('bank accounts (THUNDER_TEST_WRITE=1)', () => {
    let client: sdk.Client
    beforeAll(() => {
        client = new sdk.Client()
    })

    test('bank accounts: create, get, update, list, listAll, iterate, link, unlink', async () => {
        const params = {
            bankCode: '073',
            bankNumber: '0739990001',
            nameTh: 'บัญชีทดสอบ เอสดีเค',
            nameEn: 'SDK JS SMOKE',
            type: 'JURISTIC' as const,
        }
        let id: number
        try {
            const created = await client.bankAccounts.create(params)
            id = created.id
            record('POST /bank-accounts', 'pass', `created id ${id}`)
        } catch (error) {
            // The account is kept between runs (there is no delete endpoint), so a rerun gets 409.
            expect(error).toBeInstanceOf(sdk.ConflictError)
            let found: sdk.BankAccount | undefined
            for await (const a of client.bankAccounts.iterateAll({ bankCode: '073' })) {
                if (a.bankNumber === params.bankNumber) found = a
            }
            expect(found).toBeDefined()
            id = (found as sdk.BankAccount).id
            record('POST /bank-accounts', 'pass', `409 BANK_ACCOUNT_DUPLICATE, reusing id ${id}`)
        }
        expect((await client.bankAccounts.link(id)).linked).toBe(true)
        expect((await client.bankAccounts.link(id)).linked).toBe(true)
        record('POST /bank-accounts/{id}/link', 'pass', 'twice, idempotent')

        const got = await client.bankAccounts.get(id)
        expect(got.bankNumber).toBe(params.bankNumber)
        record('GET /bank-accounts/{id}', 'pass')

        const updated = await client.bankAccounts.update(id, {
            nameEn: 'SDK JS SMOKE UPDATED',
            extraVerify: null,
        })
        expect(updated.nameEn).toBe('SDK JS SMOKE UPDATED')
        await client.bankAccounts.update(id, { nameEn: params.nameEn })
        record('PATCH /bank-accounts/{id}', 'pass')

        const page = await client.bankAccounts.list({ bankCode: '073', limit: 100 })
        expect(page.items.some((a) => a.id === id)).toBe(true)
        record('GET /bank-accounts', 'pass')
        const all = await client.bankAccounts.listAll({ bankCode: '073', limit: 1 })
        expect(all.limit).toBe(1)
        record('GET /bank-accounts/all', 'pass')

        const walked: number[] = []
        for await (const a of client.bankAccounts.iterate({ limit: 1 })) walked.push(a.id)
        expect(walked).toContain(id)
        const walkedAll: number[] = []
        for await (const a of client.bankAccounts.iterateAll({ bankCode: '073', limit: 2 }))
            walkedAll.push(a.id)
        expect(walkedAll).toContain(id)
        record('iterate / iterateAll helpers', 'pass', 'page size 1 and 2')

        expect((await client.bankAccounts.unlink(id)).unlinked).toBe(true)
        await expectError(client.bankAccounts.get(id), sdk.NotFoundError)
        record('DELETE /bank-accounts/{id}/link', 'pass', 'left unlinked')
    })
})

withJobs('async jobs (THUNDER_TEST_CALLBACK_URL)', () => {
    let client: sdk.Client
    beforeAll(() => {
        client = new sdk.Client()
    })
    const [p0, p1] = payloads as [string, string]

    test('async: submit, get, waitForJob, batch, many', async () => {
        const one = await client.jobs.submitBank(p0, { callbackUrl, checkDuplicate: true })
        record('POST /verify/bank/async', 'pass')
        const job = await client.jobs.get(one.jobId)
        expect(job.jobId).toBe(one.jobId)
        record('GET /verify/bank/jobs/{jobId}', 'pass')
        const finished = await client.jobs.waitForJob(one.jobId, {
            interval: 1000,
            timeout: 120_000,
        })
        expect(['done', 'failed']).toContain(finished.status)
        record('waitForJob helper', 'pass', `status ${finished.status}`)
        const batch = await client.jobs.submitBankBatch(
            [{ payload: p0 }, { payload: p1, remark: 'b' }],
            { callbackUrl },
        )
        expect(batch.jobs.map((j) => j.index)).toEqual([0, 1])
        record('POST /verify/bank/batch', 'pass', '2 slips')
        const many = await client.jobs.submitBankMany([{ payload: p1 }], { callbackUrl })
        expect(many.length).toBe(1)
        record('submitBankMany helper', 'pass', '1 chunk')
        await expectError(
            client.jobs.get('00000000-0000-4000-8000-000000000000'),
            sdk.NotFoundError,
        )
    })
})

if (!hasKey) record('every test', 'skip', 'THUNDER_API_KEY or THUNDER_API_KEY_FILE not set')
else {
    if (!write) record('bank account writes', 'skip', 'THUNDER_TEST_WRITE not set')
    if (!haveSamples)
        record(
            'verify sample slips',
            'skip',
            'THUNDER_TEST_PAYLOADS_FILE / THUNDER_TEST_QR_DIR not set',
        )
    if (!callbackUrl) record('async jobs', 'skip', 'THUNDER_TEST_CALLBACK_URL not set')
}
