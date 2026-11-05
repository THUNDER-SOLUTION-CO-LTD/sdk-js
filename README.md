# Thunder SDK for JavaScript and TypeScript

[![CI](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Thunder](https://document.thunder.in.th) checks Thai bank transfer slips and TrueMoney Wallet receipts with the bank, so you know a payment is real before you credit an order. With this SDK, your Node.js, Bun or Deno server can verify a slip, confirm that it paid your account the right amount and was not used before, and receive the results of background checks through signed webhooks.

[อ่านภาษาไทย](README.th.md)

## Features

- Verify a bank transfer slip from its image, the text in its QR code, a public image URL or a base64 string.
- Confirm in the same request that the slip paid one of your bank accounts, for the amount you expect, and was not used before.
- Verify TrueMoney Wallet receipts with the same checks.
- Send up to 100 slips at a time for background checking and get each result on your webhook.
- Manage the bank accounts you receive payments to.
- Create PromptPay and bill payment QR codes for your customers to pay with.
- Handle each kind of failure with its own error class. Automatic retries never charge you twice for a slip.
- Use it from TypeScript with full types, or from JavaScript as an ES module or CommonJS. The package has no dependencies.

## Requirements

- Node.js 22, 24 or 26. Bun 1.4, Deno 2.9 and edge runtimes with `fetch`, such as Cloudflare Workers, work too.
- A Thunder API key. Sign in to the [Thunder developer portal](https://developer.thunder.in.th) and copy the API key of your application.

## Installation

```sh
npm install @thunder-solution/sdk
```

`pnpm add @thunder-solution/sdk`, `yarn add @thunder-solution/sdk` and `bun add @thunder-solution/sdk` work as well. On Deno, import from `npm:@thunder-solution/sdk`.

## Quick start

This program checks the slip a customer sent for an order of 1,500 baht. It confirms that the slip paid one of your registered bank accounts, that the amount is right and that the slip was not used before, then prints the payment.

Save it as `verify.mjs` and put the slip image next to it as `slip.jpg`:

```ts
import { Thunder, SlipNotFoundError } from '@thunder-solution/sdk'

const thunder = new Thunder() // reads your key from THUNDER_API_KEY
const orderTotal = 1500 // baht

try {
    const result = await thunder.verify.bankByImage('./slip.jpg', {
        matchAccount: true, // did the slip pay one of your bank accounts?
        matchAmount: orderTotal, // is the amount right?
        checkDuplicate: true, // was this slip used before?
    })
    const slip = result.rawSlip

    if (result.isDuplicate) {
        console.log('This slip was already used. Do not credit the order again.')
    } else if (!result.isAmountMatched) {
        console.log(`The slip pays ${result.amountInSlip} baht, but the order is ${orderTotal} baht.`)
    } else if (result.matchedAccount === null) {
        console.log('The slip does not pay any of your bank accounts.')
    } else {
        console.log('Payment confirmed')
        console.log(`Amount:    ${slip.amount.amount} THB`)
        console.log(`Date:      ${slip.date}`)
        console.log(`From:      ${slip.sender.account.name.th} (${slip.sender.bank?.short})`)
        console.log(`To:        ${slip.receiver.account.name.th} (${slip.receiver.bank?.short})`)
        console.log(`Reference: ${slip.transRef}`)
    }
} catch (error) {
    if (error instanceof SlipNotFoundError) {
        console.log('The bank has no record of this transfer. The slip may be fake or edited.')
    } else {
        throw error
    }
}
```

Run it with your API key:

```sh
THUNDER_API_KEY="your-api-key" node verify.mjs
```

For a valid slip it prints:

```text
Payment confirmed
Amount:    1500 THB
Date:      2024-01-15T14:30:00+07:00
From:      นาย ผู้โอน ทดสอบ (KBANK)
To:        บริษัท ตัวอย่าง จำกัด (SCB)
Reference: 68370160657749I376388B35
```

`matchAccount` compares the receiver with the bank accounts you registered, so add your receiving accounts first, in the developer portal or with [`bankAccounts.create`](#receiving-bank-accounts). Each verification uses one unit of your quota.

Next steps:

- [Verify slips you receive in another form](#verify-a-bank-slip), such as QR code text or an image URL.
- [See every field of the result](#the-result-object).
- [Handle errors](#error-handling) and see what the SDK retries for you.
- [Receive background results on a webhook](#webhooks).

## Usage

Each example creates its own client so that you can copy it on its own. In your application, create one client and reuse it.

### Verify a bank slip

Pick the method that matches what your customer gives you. All four return the same [result](#the-result-object) and take the same [options](#check-amount-receiving-account-and-duplicates).

| What you have | Method |
| --- | --- |
| An image file, an upload or a stream | `verify.bankByImage(image)` |
| The text in the slip's QR code, read by a QR scanner | `verify.bankByPayload(payload)` |
| A public https URL of the slip image | `verify.bankByUrl(url)` |
| The image as a base64 string, with or without a `data:` prefix | `verify.bankByBase64(base64)` |

`bankByImage` accepts a file path, a `Uint8Array` or `Buffer`, a `Blob` or `File` (for example from `request.formData()`), and web or Node.js streams. The image must be a JPEG, PNG, GIF or WebP file of at most 4 MB. A string is always read as a file path, so pass a user's upload as a `File` or as bytes, never as a string.

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const result = await thunder.verify.bankByUrl('https://example.com/slips/1001.jpg')
console.log(result.rawSlip.transRef, result.amountInSlip)
```

### Check amount, receiving account and duplicates

Turn on the checks you need with these options. Each one adds fields to the result, and an option you leave out adds nothing. When a check fails, the API still returns the slip, and your code decides what to do.

| Option | What it checks | Result fields | When the check fails |
| --- | --- | --- | --- |
| `matchAmount: 1500` | The slip amount equals the amount you expect, in baht. | `amountInOrder`, `isAmountMatched` | `isAmountMatched` is `false`. |
| `matchAccount: true` | The receiver is one of your registered bank accounts. | `matchedAccount` | `matchedAccount` is `null`. |
| `checkDuplicate: true` | The slip was verified before. | `isDuplicate` | `isDuplicate` is `true`. |
| `remark: 'Order 1001'` | Nothing. It saves your note of 1 to 255 characters with the verification. | `remark` | It never fails. |

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const result = await thunder.verify.bankByImage('./slip.jpg', {
    matchAmount: 1500,
    matchAccount: true,
    checkDuplicate: true,
    remark: 'Order 1001',
})
const accepted =
    result.isAmountMatched === true && result.matchedAccount !== null && result.isDuplicate === false
console.log(accepted ? 'accept' : 'reject', result.remark)
```

If the same branch verified the slip before, the API returns the saved result and uses no quota. If another branch verified it, the API checks it with the bank again and uses quota. `isDuplicate` is `true` in both cases.

### TrueMoney Wallet receipts

TrueMoney Wallet receipts work the same way and take the same options. Their result has a [shorter slip](#truemoney-wallet-receipt).

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const result = await thunder.verify.truewalletByImage('./wallet-receipt.png', {
    matchAmount: 500,
    checkDuplicate: true,
})
console.log(result.rawSlip.transactionId, result.rawSlip.amount, result.rawSlip.receiver.name)
```

`verify.truewalletByUrl` takes an image URL and `verify.truewalletByBase64` takes base64.

### Account info and remaining quota

`getInfo` returns your application, branch and quota. `quota.remaining` is `null` when your plan has no limit.

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const info = await thunder.getInfo()
const { used, remaining } = info.application.quota
console.log(`${info.application.name}, branch ${info.branch.name}`)
console.log(`Used ${used}, remaining ${remaining ?? 'unlimited'}`)
```

### Receiving bank accounts

These are the accounts that `matchAccount` compares the receiver with. An account belongs to your service, and a branch only matches against the accounts linked to it. `bankAccounts.create` adds an account and links it to the branch of your API key.

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const account = await thunder.bankAccounts.create({
    bankCode: '004', // bank codes come from thunder.banks.list()
    bankNumber: '1234567890',
    nameTh: 'บริษัท ตัวอย่าง จำกัด',
    nameEn: 'EXAMPLE CO., LTD.',
    type: 'JURISTIC',
})
await thunder.bankAccounts.update(account.id, { nameEn: 'EXAMPLE COMPANY LIMITED' })

// One page of the accounts linked to this branch
const page = await thunder.bankAccounts.list({ page: 1, limit: 20 })
console.log(`${page.total} accounts linked to this branch`)

// Every account in the service. The SDK fetches the pages for you.
for await (const item of thunder.bankAccounts.iterateAll()) {
    console.log(item.id, item.bankNumber, item.nameEn)
}
```

| Method | What it does |
| --- | --- |
| `bankAccounts.create(params)` | Adds an account to the service and links it to this branch. |
| `bankAccounts.get(id)` | Returns one account. |
| `bankAccounts.update(id, params)` | Changes only the fields you pass. `extraVerify: null` clears that field. |
| `bankAccounts.link(id)` | Links an account of the service to this branch. Linking twice is fine. |
| `bankAccounts.unlink(id)` | Removes the link to this branch. The account stays in the service. |
| `bankAccounts.list(params)` | Returns one page of the accounts linked to this branch. `page` starts at 1, and `limit` is 1 to 100 (default 20). |
| `bankAccounts.listAll(params)` | Returns one page of every account in the service, with the same paging. |
| `bankAccounts.iterate(params)` | Goes through every account linked to this branch, 100 per page. |
| `bankAccounts.iterateAll(params)` | Goes through every account in the service, 100 per page. |

`type` is `NATURAL` for a personal account or `JURISTIC` for a company account, and the `AccountType` type accepts only those two values. The four list methods can filter by `type` and by `bankCode`. Adding an account that already exists throws `ConflictError`.

### Verify many slips in the background

A background job checks a slip on the Thunder side and posts the result to your [webhook](#webhooks). Use jobs when you have many slips or do not want to wait for the bank. Pass an https `callbackUrl`, unless your branch already has a default webhook URL.

This example reads the QR code text of several slips from `payloads.txt`, one per line, and submits them as one batch:

```ts
import { readFile } from 'node:fs/promises'
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()
const payloads = (await readFile('payloads.txt', 'utf8')).split('\n').filter(Boolean)

const batch = await thunder.jobs.submitBankBatch(
    payloads.map((payload) => ({ payload, checkDuplicate: true })),
    { callbackUrl: 'https://example.com/webhooks/thunder' },
)

// Your webhook receives every result. You can also wait for a job here:
for (const { jobId } of batch.jobs) {
    const job = await thunder.jobs.waitForJob(jobId)
    console.log(jobId, job.status, job.result?.status, job.result?.data?.amountInSlip)
}
```

| Method | What it does |
| --- | --- |
| `jobs.submitBank(payload, options)` | Submits one slip, with the same options as `verify` plus `callbackUrl`. |
| `jobs.submitBankBatch(slips, { callbackUrl })` | Submits 1 to 100 slips in one request. Each slip has its own options. |
| `jobs.submitBankMany(slips, { callbackUrl })` | Submits any number of slips in batches of 100, one batch after another. |
| `jobs.get(jobId)` | Returns the job, with its result once it has finished. |
| `jobs.waitForJob(jobId, options)` | Checks the job every `interval` milliseconds (default 2000) until it is `done` or `failed`, for at most `timeout` milliseconds (default 600000, which is 10 minutes). |

### Generate a payment QR code

The API creates PromptPay and bill payment QR codes that your customers scan to pay you. Creating a QR code uses no quota. `amount` is in baht, from 0.01 to 9,999,999,999.99 with at most two decimals. Leave it out to let the payer type the amount.

```ts
import { writeFile } from 'node:fs/promises'
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

// PromptPay to a phone number, for 250 baht
const promptPay = await thunder.v1.generateQr({ type: 'PROMPTPAY', msisdn: '0812345678', amount: 250 })
await writeFile('promptpay.png', promptPay.imageBytes())

// Bill payment to your biller ID, with your invoice number as reference 1
const bill = await thunder.v1.generateQr({
    type: 'PROMPTPAY',
    billerId: '010555512345601',
    ref1: 'INV1001',
    amount: 1500,
})
await writeFile('bill.png', bill.imageBytes())
```

| `type` | Required fields | Optional fields |
| --- | --- | --- |
| `PROMPTPAY` | One of `msisdn` (phone number), `natId` (national ID or tax ID), `eWalletId` or `billerId` | `amount`, and `ref1` and `ref2` with `billerId` |
| `KSHOP` | `ref1`, the shop ID: `KB` followed by 12 digits | `amount` |
| `MAE_MANEE` | `ref1`, the 15-digit shop ID | `amount` |
| `TUNGNGERN` | `ref1`, the merchant code, and `merchantName`, the shop name in English | `amount` |

The older `BILL_PAYMENT` type still works. With the same `billerId` it creates the same QR code as `PROMPTPAY`. The `QrType` type lists the five types the API accepts.

### Legacy API v1

Use `thunder.v1` only if your integration already uses API v1. New code should use the v2 methods above. The v1 methods return the slip itself, and with `checkDuplicate: true` a slip that was verified before throws `DuplicateSlipError`.

```ts
import { DuplicateSlipError, Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

try {
    const slip = await thunder.v1.verifyBankByImage('./slip.jpg', { checkDuplicate: true })
    console.log(slip.transRef, slip.amount.amount)
} catch (error) {
    if (!(error instanceof DuplicateSlipError)) throw error
    console.log('This slip was already used. Transfer date:', error.slip?.date)
}
```

API v1 also has `verifyBankByPayload`, `verifyBankByUrl`, `verifyBankByBase64`, `verifyTruemoneyByImage` and `getMe`.

### Promises, timeouts and cancelling

Every method returns a promise, so you can check several slips at once. Pass `signal` to cancel a call or to give it a deadline. Keep the number of calls in flight small, because the API limits how many requests you can send.

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()
const files = ['./slip-1001.jpg', './slip-1002.jpg', './slip-1003.jpg']

const outcomes = await Promise.allSettled(
    files.map((file) =>
        thunder.verify.bankByImage(file, { checkDuplicate: true, signal: AbortSignal.timeout(60_000) }),
    ),
)
outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') console.log(files[index], outcome.value.rawSlip.transRef)
    else console.log(files[index], 'failed:', outcome.reason)
})
```

## The result object

A v2 verification returns your check results at the top level and the slip as the bank reports it in `rawSlip`. The [API reference](https://document.thunder.in.th/en/v2/verify/bank/) describes the full model.

### Bank slip

| Field | Type | Meaning | Example |
| --- | --- | --- | --- |
| `amountInSlip` | `number` | The amount transferred, in baht. | `1500` |
| `isAmountMatched` | `boolean` | Whether the amount equals `matchAmount`. Only with `matchAmount`. | `true` |
| `amountInOrder` | `number` | The `matchAmount` you sent. Only with `matchAmount`. | `1500` |
| `matchedAccount` | `object` or `null` | Your registered account that the slip paid, or `null`. Only with `matchAccount`. | `{ bankNumber: '123-4-56789-0', ... }` |
| `isDuplicate` | `boolean` | Whether the slip was verified before. Only with `checkDuplicate`. | `false` |
| `remark` | `string` | Your `remark`. Only when you sent one. | `'Order 1001'` |
| `rawSlip.transRef` | `string` | The bank's reference for the transfer. Each transfer has its own, so you can store it to catch reuse. | `'68370160657749I376388B35'` |
| `rawSlip.date` | `string` | When the transfer happened, in ISO 8601 with the Thai time offset. | `'2024-01-15T14:30:00+07:00'` |
| `rawSlip.amount.amount` | `number` | The amount, in baht. | `1500` |
| `rawSlip.fee` | `number` | The transfer fee, when the bank reports one. | `0` |
| `rawSlip.sender.bank` | `object` | The sender's bank: `id` (the bank code), `name` and `short`. | `{ id: '004', name: 'กสิกรไทย', short: 'KBANK' }` |
| `rawSlip.sender.account.name` | `object` | The sender's name in Thai (`th`) and English (`en`), when the bank shows it. | `{ th: 'นาย ผู้โอน ทดสอบ', en: 'MR. SENDER TEST' }` |
| `rawSlip.sender.account.bank` | `object` | The sender's account number, partly hidden by the bank. | `{ type: 'BANKAC', account: '123-4-xxxxx-5' }` |
| `rawSlip.receiver.bank` | `object` | The receiver's bank, in the same form as the sender's. | `{ id: '014', name: 'ไทยพาณิชย์', short: 'SCB' }` |
| `rawSlip.receiver.account.name` | `object` | The receiver's name. | `{ th: 'บริษัท ตัวอย่าง จำกัด' }` |
| `rawSlip.receiver.account.bank` | `object` | The receiver's account number, partly hidden. | `{ type: 'BANKAC', account: 'xxx-x-x5678-x' }` |
| `rawSlip.receiver.account.proxy` | `object` | The PromptPay ID the money was sent to, when the transfer used one. | `{ type: 'MSISDN', account: '08xxxxxxxx89' }` |
| `rawSlip.ref1`, `rawSlip.ref2`, `rawSlip.ref3` | `string` | Bill payment references. They are empty for ordinary transfers. | `''` |

### TrueMoney Wallet receipt

The top-level fields are the same as for a bank slip. `rawSlip` holds:

| Field | Type | Meaning | Example |
| --- | --- | --- | --- |
| `rawSlip.transactionId` | `string` | The TrueMoney transaction ID. | `'50012345678901'` |
| `rawSlip.date` | `string` | When the payment happened, in ISO 8601. | `'2026-10-26T14:30:00+07:00'` |
| `rawSlip.amount` | `number` | The amount, in baht. | `500` |
| `rawSlip.sender.name` | `string` | The payer's name. | `'นาย ผู้โอน ทดสอบ'` |
| `rawSlip.receiver.name` | `string` | The receiver's name. | `'นาย รับเงิน ทดสอบ'` |
| `rawSlip.receiver.phone` | `string` | The receiver's phone number, partly hidden. | `'08x-xxx-4567'` |

Every result also has a `meta` property with the HTTP status, the `requestId`, the rate limit counters and the response headers. It is not part of the data, so `JSON.stringify(result)` leaves it out.

## Configuration

Pass options to `new Thunder({ ... })`. An option you leave out comes from its environment variable, or else from its default.

| Option | Environment variable | Default | What it does |
| --- | --- | --- | --- |
| `apiKey` | `THUNDER_API_KEY` | None | Your API key. Without a key, `new Thunder()` throws `InputError`. |
| No option | `THUNDER_API_KEY_FILE` | None | The path of a file that holds your API key, such as a Docker or Kubernetes secret. The SDK uses it when there is no `apiKey` and no `THUNDER_API_KEY`. |
| `timeout` | No variable | `30000` | How long one attempt may take, in milliseconds. |
| `maxRetries` | No variable | `2` | How many times the SDK retries a failed request. `0` turns retries off. |
| `fetch` | No variable | The global `fetch` | The function the SDK sends requests with. |
| `v2BaseUrl` | `THUNDER_V2_BASE_URL` | `https://api.thunder.in.th/v2` | The address of API v2. |
| `v1BaseUrl` | `THUNDER_V1_BASE_URL` | `https://api.thunder.in.th/v1` | The address of API v1. |
| No option | `THUNDER_WEBHOOK_SECRET` | None | Your webhook secret. The [webhook functions](#webhooks) use it when you do not pass a secret. |

Every method also takes `timeout`, `maxRetries` and `signal` for that call alone. Verification methods take them together with the verification options, for example `verify.bankByImage(file, { checkDuplicate: true, timeout: 10_000 })`.

### Custom HTTP client

Pass your own `fetch` to log requests, send them through a proxy or record them in tests. It receives the URL and the request options, and it returns a `Response`.

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder({
    fetch: async (url, init) => {
        const started = Date.now()
        const response = await fetch(url, init)
        console.log(init.method, url, response.status, `${Date.now() - started} ms`)
        return response
    },
})
console.log((await thunder.getInfo()).application.name)
```

The client opens no connections of its own, so you do not need to close it. If your `fetch` uses its own connection pool, such as an undici `Agent`, close that pool when your application shuts down.

## Error handling

Every error the SDK throws is an `ThunderError`. Errors that come from the API are `ApiError`s, and they carry `status`, `code` (such as `SLIP_NOT_FOUND`), `message`, `requestId` and `retryAfter`. Some classes are subclasses of others: `QuotaExceededError` is a `PermissionDeniedError`; `InvalidImageError`, `InvalidUrlError` and `DuplicateSlipError` are `InvalidRequestError`s; `SlipNotFoundError` and `SlipPendingError` are `NotFoundError`s; `ServiceUnavailableError` is a `ServerError`; and `RequestTimeoutError` is a `NetworkError`.

| Error class | HTTP status | When it happens | What to do |
| --- | --- | --- | --- |
| `AuthenticationError` | 401 | The API key is missing, wrong or revoked. | Check the key you pass or `THUNDER_API_KEY`. Create a new key in the developer portal if you need one. |
| `PermissionDeniedError` | 403 | The key is valid but may not make this request, for example because the branch is turned off, the plan has expired or your server's IP address is not on the allowed list. | Read `error.code`, then fix that setting in the developer portal. |
| `QuotaExceededError` | 403 | Your quota is used up. This request was not charged. | Top up or change your plan, then send the request again. |
| `InvalidRequestError` | 400 | The API rejected a value in the request, such as the QR code text or an option. | Fix the value that `error.message` names. Sending the same request again fails the same way. |
| `InvalidImageError` | 400 | The image has no readable slip QR code, is not a supported type or is too large. | Ask the customer for a clear JPEG, PNG, GIF or WebP image under 4 MB. |
| `InvalidUrlError` | 400 | The image URL or `callbackUrl` points to a private address, does not use http or https, or cannot be reached. | Use a public https URL. |
| `DuplicateSlipError` | 400 | Only in API v1 with `checkDuplicate: true`: the slip was verified before. `error.slip` holds the first result. | Treat the payment as already received and do not credit it again. |
| `NotFoundError` | 404 | The bank account, job or other item you asked for does not exist. | Check the ID you passed. |
| `SlipNotFoundError` | 404 | The bank has no transfer that matches this slip. | Do not accept the payment. Ask the customer for the original slip. |
| `SlipPendingError` | 404 | The bank has not published the transfer yet. This happens with very recent Bangkok Bank slips. | Verify the slip again after a minute. |
| `ConflictError` | 409 | The bank account you are adding already exists. | Use the existing account. `bankAccounts.listAll()` finds it. |
| `RateLimitError` | 429 | You sent too many requests. `error.retryAfter` says how many seconds to wait. | Send fewer requests at the same time. The SDK has already retried this one. |
| `ServerError` | 500, 502, 504; other 5xx except 503 | Something failed on the Thunder side. | Try again later. If it keeps happening, contact support with `error.requestId`. |
| `ServiceUnavailableError` | 503 | The service is briefly unavailable, for example while quotas renew. | Try again in a few minutes. |
| `ApiError` | Another 4xx status | The API answered with an error status that has no class of its own. | Log `status`, `code` and `requestId`, and contact support if it continues. |
| `NetworkError` | Network | No response arrived, because of a DNS, connection or TLS failure. | Check your network or proxy, then try again. |
| `RequestTimeoutError` | Network | No response arrived within `timeout`. | Try again, or raise `timeout`. A verification may already have been counted. |
| `InputError` | Before sending | The SDK found a problem before sending, such as a missing API key, empty QR code text, an image over 4 MB or a file that is not an image. `error.code` names the problem. | Fix the value you passed. |
| `WebhookSignatureError` | Before sending | A webhook has no signature, or its signature does not match. | Reject the webhook with status 400. |
| `JobWaitTimeoutError` | Before sending | `waitForJob` reached its `timeout`. `error.lastJob` is the last state it saw. | Wait longer, or rely on the webhook. |
| `BatchSubmitError` | Before sending | `submitBankMany` stopped part way. `error.submitted` lists the batches that were sent, and `error.failedChunk` is the batch that failed. | Submit the failed batch and the ones after it again. Batches that were already sent keep running. |

This example checks an uploaded slip at checkout and turns each failure into a message for the customer:

```ts
import { readFile } from 'node:fs/promises'
import {
    ApiError,
    Thunder,
    InvalidImageError,
    QuotaExceededError,
    RateLimitError,
    SlipNotFoundError,
    SlipPendingError,
} from '@thunder-solution/sdk'

const thunder = new Thunder()

async function checkPayment(upload: File, orderTotal: number): Promise<string> {
    try {
        const result = await thunder.verify.bankByImage(upload, {
            matchAmount: orderTotal,
            matchAccount: true,
            checkDuplicate: true,
        })
        if (result.isDuplicate) return 'This slip has already been used.'
        if (!result.isAmountMatched) return `This slip is for ${result.amountInSlip} baht.`
        if (result.matchedAccount === null) return 'This slip was not paid to our account.'
        return 'Payment received.'
    } catch (error) {
        if (error instanceof SlipNotFoundError) return 'We could not find this transfer at the bank.'
        if (error instanceof SlipPendingError) return 'The bank is still processing this transfer. Try again in a minute.'
        if (error instanceof InvalidImageError) return 'Please upload a clear photo or screenshot of the slip.'
        if (error instanceof QuotaExceededError || error instanceof RateLimitError) {
            console.error('Thunder limit reached', error.code, error.requestId)
            return 'We cannot check slips right now. Please try again shortly.'
        }
        if (error instanceof ApiError) {
            console.error('Thunder error', error.status, error.code, error.requestId)
            return 'We could not check the slip. Please try again.'
        }
        throw error
    }
}

const upload = new File([await readFile('./slip.jpg')], 'slip.jpg', { type: 'image/jpeg' })
console.log(await checkPayment(upload, 1500))
```

### What the SDK retries

The SDK retries a failed request up to `maxRetries` times (2 by default). It waits about half a second before the first retry and doubles the wait each time, up to 8 seconds. When the API sends `Retry-After`, the SDK waits that long instead, but if the wait is longer than 60 seconds it throws the error at once.

| Request | Retried when | Never retried when |
| --- | --- | --- |
| Reading data and linking accounts: `getInfo`, `banks.list`, `bankAccounts.list`, `listAll`, `get` and `link`, `jobs.get`, `v1.getMe`, `v1.generateQr` | The network fails, the call times out, or the API answers 429, 500, 502, 503 or 504. | The API answers 400, 401, 403, 404 or 409. |
| Verifications and job submissions, which use quota | The API answers 429, or the connection failed before the request left your server. | The request was sent and then timed out or got a 5xx answer. |
| Changing bank accounts: `create`, `update` and `unlink` | The API answers 429, or the connection failed before the request left your server. | The request was sent and then timed out or got a 5xx answer. |

A verification that reached the API may have been counted even if no answer came back. Retrying it could charge you twice, so the SDK leaves that decision to you.

## Webhooks

When a background job finishes, Thunder sends a POST request to your `callbackUrl`. If your branch has a webhook secret, the request has an `X-Thunder-Signature` header. Check the signature against the raw body before you parse or trust anything in it.

This server uses only Node.js:

```ts
import { createServer } from 'node:http'
import {
    constructWebhookEvent,
    InputError,
    WEBHOOK_SIGNATURE_HEADER,
    WebhookSignatureError,
} from '@thunder-solution/sdk'

if (!process.env.THUNDER_WEBHOOK_SECRET) throw new Error('Set THUNDER_WEBHOOK_SECRET')

createServer(async (request, response) => {
    try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk as Buffer)
        const rawBody = Buffer.concat(chunks)
        const signature = request.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()]

        // Uses the secret in THUNDER_WEBHOOK_SECRET
        const event = constructWebhookEvent(rawBody, signature)
        if (event.status === 'success') {
            console.log('Verified', event.jobId, event.data?.rawSlip.transRef, event.data?.amountInSlip)
        } else {
            console.log('Not verified', event.jobId, event.status, event.error?.code)
        }
        response.writeHead(200).end('ok')
    } catch (error) {
        if (error instanceof WebhookSignatureError || error instanceof InputError) {
            // The signature is missing or wrong, or the signed body is not a webhook event
            response.writeHead(400).end('invalid webhook')
        } else {
            console.error('Webhook failed', error)
            response.writeHead(500).end('error')
        }
    }
}).listen(3000)
```

The server answers 400 when the signature is missing or wrong and when a signed body is not a webhook event, and 500 when anything else fails. Thunder sends the event again after a non-2xx answer.

In Express, add `express.raw({ type: 'application/json' })` to the webhook route so that `req.body` is the raw body as a `Buffer`, then pass `req.body` and `req.get(WEBHOOK_SIGNATURE_HEADER)` to `constructWebhookEvent`. Do not use `express.json()` on that route. Parsing the JSON and turning it back into text changes the bytes, and the signature then no longer matches.

| Function | What it does |
| --- | --- |
| `constructWebhookEvent(rawBody, header, secret?)` | Checks the signature, then returns the parsed event. It throws `WebhookSignatureError` when the signature is missing or wrong, and `InputError` when the body is not a JSON object with `jobId`, `status` and `timestamp`. |
| `verifyWebhookSignature(rawBody, header, secret?)` | Returns `true` when the signature matches and `false` when it does not. |
| `parseWebhookEvent(rawBody)` | Parses the event without checking the signature, and throws `InputError` for a body that is not an event. Use it only after you have checked the signature yourself. |

`secret` defaults to `THUNDER_WEBHOOK_SECRET`. Answer with a 2xx status within 5 seconds. Thunder may send the same event more than once, so use `jobId` to skip events you have already handled.

## Security and privacy

- Keep your API key on your server. Never put it in a web page, a mobile app or a public repository, because anyone who has the key can use your quota.
- Load the key from `THUNDER_API_KEY` or a secret file instead of writing it in your code.
- The SDK never puts your API key in error messages, so you can log its errors.
- Slips show names, bank accounts and amounts, which are personal data. Store only what you need, protect it like your other customer data and follow the Thai Personal Data Protection Act (PDPA).
- Check the signature of every webhook before you act on it.

## Versioning and support policy

- Releases follow [semantic versioning](https://semver.org). Minor and patch releases do not break existing code. A breaking change comes in a new major version with upgrade notes in the changelog.
- The SDK supports the Node.js versions that the Node.js project still maintains. After a Node.js version reaches its end of life, a later release may stop supporting it, and the changelog says so.
- [CHANGELOG.md](CHANGELOG.md) and the [releases page](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/releases) list every release and its changes.

## Examples and documentation

- [`examples`](examples) has one runnable program for every method. Clone this repository, run `bun install` and `bun run build`, then run an example, for example `THUNDER_API_KEY="your-api-key" node examples/verify-bank-image.ts ./slip.jpg`. If you leave out its arguments, an example prints how to call it.
- The [SDK guide](https://document.thunder.in.th/en/sdk/javascript) covers this SDK in the Thunder documentation.
- The [API reference](https://document.thunder.in.th) describes every endpoint, field and [error code](https://document.thunder.in.th/en/reference/error-codes).

## Support

For account, quota or billing questions, use the [contact page](https://developer.thunder.in.th/contact) and include the request id if available. Report bugs and suggest features in [issues](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/issues). Never post API keys or real slip images.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and pull requests. Maintainers follow [RELEASING.md](RELEASING.md).

## Security reports

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), or use the [contact page](https://developer.thunder.in.th/contact). Never report vulnerabilities in public issues.

## License

[MIT](LICENSE). Copyright (c) 2026 Thunder Solution Co., Ltd.
