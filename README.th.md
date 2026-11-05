# Thunder SDK สำหรับ JavaScript และ TypeScript

[![CI](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Thunder](https://document.thunder.in.th) ตรวจสลิปโอนเงินของธนาคารไทยและสลิป TrueMoney Wallet กับธนาคารให้ จึงรู้ได้ว่าลูกค้าโอนเงินมาจริงก่อนยืนยันออเดอร์ SDK นี้ช่วยให้เซิร์ฟเวอร์ Node.js, Bun หรือ Deno ของคุณตรวจสลิปได้ในไม่กี่บรรทัด เช็กได้ว่าเงินเข้าบัญชีของคุณ ยอดเงินถูกต้อง และไม่ใช่สลิปซ้ำ รวมถึงรับผลการตรวจเบื้องหลังผ่านเว็บฮุคที่มีลายเซ็นยืนยัน

[Read in English](README.md)

## ความสามารถ

- ตรวจสลิปโอนเงินได้จากรูปสลิป ข้อความในคิวอาร์โค้ด URL ของรูป หรือ base64
- เช็กในคำขอเดียวว่าสลิปโอนเข้าบัญชีรับเงินของคุณ ยอดเงินตรงกับออเดอร์ และไม่เคยถูกใช้มาก่อน
- ตรวจสลิป TrueMoney Wallet ได้ด้วยเงื่อนไขชุดเดียวกัน
- ส่งสลิปไปตรวจเบื้องหลังได้ครั้งละสูงสุด 100 ใบ แล้วรับผลแต่ละใบทางเว็บฮุค
- จัดการบัญชีธนาคารที่ใช้รับเงิน
- สร้างคิวอาร์ PromptPay และคิวอาร์ชำระบิลให้ลูกค้าสแกนจ่าย
- แยกคลาส error ตามสาเหตุ และระบบลองใหม่อัตโนมัติจะไม่ทำให้สลิปใบเดียวถูกคิดโควต้าซ้ำ
- ใช้กับ TypeScript ได้พร้อม type ครบ หรือใช้กับ JavaScript แบบ ES module และ CommonJS ก็ได้ ตัวแพ็กเกจไม่มี dependency

## สิ่งที่ต้องมี

- Node.js 22, 24 หรือ 26 ใช้กับ Bun 1.4, Deno 2.9 และ edge runtime ที่มี `fetch` เช่น Cloudflare Workers ได้ด้วย
- API key ของ Thunder เข้าสู่ระบบที่ [Thunder developer portal](https://developer.thunder.in.th) แล้วคัดลอก API key ของแอปพลิเคชันมาใช้

## การติดตั้ง

```sh
npm install @thunder-solution/sdk
```

ใช้ `pnpm add @thunder-solution/sdk`, `yarn add @thunder-solution/sdk` หรือ `bun add @thunder-solution/sdk` ก็ได้ ส่วน Deno ให้ import จาก `npm:@thunder-solution/sdk`

## เริ่มต้นใช้งาน

โปรแกรมนี้ตรวจสลิปที่ลูกค้าส่งมาจ่ายออเดอร์ยอด 1,500 บาท โดยเช็กว่าเงินเข้าบัญชีรับเงินที่ลงทะเบียนไว้ ยอดเงินถูกต้อง และสลิปไม่ซ้ำ จากนั้นพิมพ์รายละเอียดการโอนออกมา

บันทึกโค้ดเป็นไฟล์ `verify.mjs` แล้ววางรูปสลิปไว้ข้างกันในชื่อ `slip.jpg`

```ts
import { Thunder, SlipNotFoundError } from '@thunder-solution/sdk'

const thunder = new Thunder() // อ่าน API key จาก THUNDER_API_KEY
const orderTotal = 1500 // บาท

try {
    const result = await thunder.verify.bankByImage('./slip.jpg', {
        matchAccount: true, // เงินเข้าบัญชีรับเงินของเราไหม
        matchAmount: orderTotal, // ยอดเงินถูกไหม
        checkDuplicate: true, // เป็นสลิปซ้ำไหม
    })
    const slip = result.rawSlip

    if (result.isDuplicate) {
        console.log('สลิปนี้เคยใช้แล้ว อย่ายืนยันออเดอร์ซ้ำ')
    } else if (!result.isAmountMatched) {
        console.log(`สลิปนี้โอน ${result.amountInSlip} บาท แต่ออเดอร์ยอด ${orderTotal} บาท`)
    } else if (result.matchedAccount === null) {
        console.log('สลิปนี้ไม่ได้โอนเข้าบัญชีรับเงินของเรา')
    } else {
        console.log('ยืนยันการชำระเงินแล้ว')
        console.log(`ยอดเงิน:   ${slip.amount.amount} บาท`)
        console.log(`วันที่:     ${slip.date}`)
        console.log(`ผู้โอน:    ${slip.sender.account.name.th} (${slip.sender.bank?.short})`)
        console.log(`ผู้รับ:     ${slip.receiver.account.name.th} (${slip.receiver.bank?.short})`)
        console.log(`เลขอ้างอิง: ${slip.transRef}`)
    }
} catch (error) {
    if (error instanceof SlipNotFoundError) {
        console.log('ไม่พบรายการโอนนี้ที่ธนาคาร สลิปอาจเป็นของปลอมหรือถูกแก้ไข')
    } else {
        throw error
    }
}
```

รันพร้อม API key ของคุณ

```sh
THUNDER_API_KEY="your-api-key" node verify.mjs
```

ถ้าสลิปถูกต้อง จะได้ผลแบบนี้

```text
ยืนยันการชำระเงินแล้ว
ยอดเงิน:   1500 บาท
วันที่:     2024-01-15T14:30:00+07:00
ผู้โอน:    นาย ผู้โอน ทดสอบ (KBANK)
ผู้รับ:     บริษัท ตัวอย่าง จำกัด (SCB)
เลขอ้างอิง: 68370160657749I376388B35
```

`matchAccount` เทียบบัญชีผู้รับกับบัญชีรับเงินที่คุณลงทะเบียนไว้ จึงต้องเพิ่มบัญชีรับเงินก่อน ทำได้ใน developer portal หรือใช้ [`bankAccounts.create`](#receiving-bank-accounts) การตรวจสลิปแต่ละครั้งใช้โควต้า 1 ครั้ง

อ่านต่อ

- [ตรวจสลิปจากข้อมูลรูปแบบอื่น](#verify-a-bank-slip) เช่น ข้อความในคิวอาร์หรือ URL ของรูป
- [ดูฟิลด์ทั้งหมดของผลการตรวจ](#the-result-object)
- [จัดการ error](#error-handling) และดูว่า SDK ลองใหม่ให้ในกรณีไหนบ้าง
- [รับผลการตรวจเบื้องหลังทางเว็บฮุค](#webhooks)

## วิธีใช้งาน

ตัวอย่างในส่วนนี้สร้าง client ใหม่ทุกครั้งเพื่อให้คัดลอกไปใช้ได้ทันที ในแอปจริงให้สร้าง client ครั้งเดียวแล้วใช้ซ้ำ

<a id="verify-a-bank-slip"></a>

### ตรวจสลิปธนาคาร

เลือกเมธอดตามข้อมูลที่ลูกค้าส่งมา ทั้งสี่เมธอดคืน[ผลการตรวจ](#the-result-object)แบบเดียวกันและรับ[ตัวเลือก](#check-amount-receiving-account-and-duplicates)ชุดเดียวกัน

| ข้อมูลที่มี | เมธอด |
| --- | --- |
| ไฟล์รูป ไฟล์ที่อัปโหลดมา หรือ stream | `verify.bankByImage(image)` |
| ข้อความในคิวอาร์โค้ดของสลิปที่อ่านด้วยตัวสแกน | `verify.bankByPayload(payload)` |
| URL แบบ https ของรูปสลิปที่เปิดได้จากภายนอก | `verify.bankByUrl(url)` |
| รูปที่เข้ารหัสเป็น base64 จะมี `data:` นำหน้าหรือไม่ก็ได้ | `verify.bankByBase64(base64)` |

`bankByImage` รับ path ของไฟล์, `Uint8Array` หรือ `Buffer`, `Blob` หรือ `File` (เช่น จาก `request.formData()`) และ stream ทั้งแบบ web และ Node.js รูปต้องเป็น JPEG, PNG, GIF หรือ WebP ขนาดไม่เกิน 4 MB ถ้าส่ง string เข้าไป SDK จะถือว่าเป็น path ของไฟล์เสมอ ไฟล์ที่ผู้ใช้อัปโหลดจึงต้องส่งเป็น `File` หรือ bytes ห้ามส่งเป็น string

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const result = await thunder.verify.bankByUrl('https://example.com/slips/1001.jpg')
console.log(result.rawSlip.transRef, result.amountInSlip)
```

<a id="check-amount-receiving-account-and-duplicates"></a>

### เช็กยอดเงิน บัญชีรับเงิน และสลิปซ้ำ

เปิดการตรวจที่ต้องการด้วยตัวเลือกด้านล่าง ตัวเลือกแต่ละตัวจะเพิ่มฟิลด์ในผลการตรวจ ถ้าไม่ใส่ก็จะไม่มีฟิลด์นั้น เมื่อเงื่อนไขไม่ผ่าน API ยังคืนข้อมูลสลิปมาให้ตามปกติ โค้ดของคุณเป็นคนตัดสินว่าจะรับยอดหรือไม่

| ตัวเลือก | ตรวจอะไร | ฟิลด์ในผลการตรวจ | เมื่อไม่ผ่าน |
| --- | --- | --- | --- |
| `matchAmount: 1500` | ยอดเงินในสลิปตรงกับยอดที่คาดไว้ หน่วยเป็นบาท | `amountInOrder`, `isAmountMatched` | `isAmountMatched` เป็น `false` |
| `matchAccount: true` | ผู้รับเงินเป็นบัญชีรับเงินที่ลงทะเบียนไว้ | `matchedAccount` | `matchedAccount` เป็น `null` |
| `checkDuplicate: true` | สลิปนี้เคยถูกตรวจมาแล้ว | `isDuplicate` | `isDuplicate` เป็น `true` |
| `remark: 'Order 1001'` | ไม่ได้ตรวจอะไร แค่บันทึกโน้ตยาว 1 ถึง 255 ตัวอักษรไว้กับการตรวจครั้งนี้ | `remark` | ไม่มีกรณีไม่ผ่าน |

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
console.log(accepted ? 'รับยอด' : 'ไม่รับยอด', result.remark)
```

ถ้าสาขาเดียวกันเคยตรวจสลิปนี้แล้ว API จะคืนผลเดิมที่บันทึกไว้และไม่ใช้โควต้า ถ้าเป็นสาขาอื่นที่เคยตรวจ API จะตรวจกับธนาคารใหม่และใช้โควต้า ทั้งสองกรณี `isDuplicate` เป็น `true`

### สลิป TrueMoney Wallet

สลิป TrueMoney Wallet ใช้งานแบบเดียวกันและรับตัวเลือกชุดเดียวกัน แต่ข้อมูลสลิปใน[ผลการตรวจ](#truemoney-wallet-receipt)สั้นกว่า

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const result = await thunder.verify.truewalletByImage('./wallet-receipt.png', {
    matchAmount: 500,
    checkDuplicate: true,
})
console.log(result.rawSlip.transactionId, result.rawSlip.amount, result.rawSlip.receiver.name)
```

ใช้ `verify.truewalletByUrl` เมื่อมี URL ของรูป และ `verify.truewalletByBase64` เมื่อมี base64

### ข้อมูลบัญชีและโควต้าคงเหลือ

`getInfo` คืนข้อมูลแอปพลิเคชัน สาขา และโควต้า ถ้าแพ็กเกจไม่จำกัดโควต้า `quota.remaining` จะเป็น `null`

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const info = await thunder.getInfo()
const { used, remaining } = info.application.quota
console.log(`${info.application.name}, สาขา ${info.branch.name}`)
console.log(`ใช้ไป ${used} คงเหลือ ${remaining ?? 'ไม่จำกัด'}`)
```

<a id="receiving-bank-accounts"></a>

### บัญชีรับเงิน

`matchAccount` เทียบผู้รับเงินในสลิปกับบัญชีกลุ่มนี้ บัญชีรับเงินเป็นของบริการ (service) และแต่ละสาขาจะเทียบเฉพาะบัญชีที่ผูกกับสาขานั้น `bankAccounts.create` เพิ่มบัญชีแล้วผูกกับสาขาของ API key ให้ทันที

```ts
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

const account = await thunder.bankAccounts.create({
    bankCode: '004', // รหัสธนาคารดูได้จาก thunder.banks.list()
    bankNumber: '1234567890',
    nameTh: 'บริษัท ตัวอย่าง จำกัด',
    nameEn: 'EXAMPLE CO., LTD.',
    type: 'JURISTIC',
})
await thunder.bankAccounts.update(account.id, { nameEn: 'EXAMPLE COMPANY LIMITED' })

// บัญชีที่ผูกกับสาขานี้ทีละหน้า
const page = await thunder.bankAccounts.list({ page: 1, limit: 20 })
console.log(`ผูกกับสาขานี้ ${page.total} บัญชี`)

// ทุกบัญชีในบริการ SDK ดึงทุกหน้าให้เอง
for await (const item of thunder.bankAccounts.iterateAll()) {
    console.log(item.id, item.bankNumber, item.nameEn)
}
```

| เมธอด | ใช้ทำอะไร |
| --- | --- |
| `bankAccounts.create(params)` | เพิ่มบัญชีเข้าบริการและผูกกับสาขานี้ |
| `bankAccounts.get(id)` | ดึงข้อมูลบัญชีเดียว |
| `bankAccounts.update(id, params)` | แก้เฉพาะฟิลด์ที่ส่งมา ส่ง `extraVerify: null` เพื่อล้างค่านั้น |
| `bankAccounts.link(id)` | ผูกบัญชีของบริการกับสาขานี้ ผูกซ้ำก็ไม่เป็นไร |
| `bankAccounts.unlink(id)` | ยกเลิกการผูกกับสาขานี้ บัญชียังอยู่ในบริการ |
| `bankAccounts.list(params)` | ดึงบัญชีที่ผูกกับสาขานี้หนึ่งหน้า `page` เริ่มที่ 1 และ `limit` อยู่ระหว่าง 1 ถึง 100 (ค่าเริ่มต้น 20) |
| `bankAccounts.listAll(params)` | ดึงบัญชีทั้งหมดของบริการหนึ่งหน้า แบ่งหน้าแบบเดียวกัน |
| `bankAccounts.iterate(params)` | ไล่ดูทุกบัญชีที่ผูกกับสาขานี้ ดึงหน้าละ 100 บัญชี |
| `bankAccounts.iterateAll(params)` | ไล่ดูทุกบัญชีของบริการ ดึงหน้าละ 100 บัญชี |

`type` เป็น `NATURAL` สำหรับบัญชีบุคคลธรรมดา หรือ `JURISTIC` สำหรับบัญชีนิติบุคคล และ type `AccountType` รับได้แค่สองค่านี้ เมธอดดึงรายการทั้งสี่ตัวกรองด้วย `type` และ `bankCode` ได้ ถ้าเพิ่มบัญชีที่มีอยู่แล้วจะได้ `ConflictError`

### ตรวจสลิปจำนวนมากเบื้องหลัง

งานเบื้องหลัง (job) จะตรวจสลิปที่ฝั่ง Thunder แล้วส่งผลไปที่[เว็บฮุค](#webhooks)ของคุณ เหมาะเมื่อมีสลิปจำนวนมากหรือไม่อยากรอธนาคารตอบ ต้องส่ง `callbackUrl` แบบ https ทุกครั้ง เว้นแต่สาขาตั้ง Default Webhook URL ไว้แล้ว

ตัวอย่างนี้อ่านข้อความคิวอาร์ของสลิปหลายใบจาก `payloads.txt` บรรทัดละใบ แล้วส่งตรวจเป็นชุดเดียว

```ts
import { readFile } from 'node:fs/promises'
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()
const payloads = (await readFile('payloads.txt', 'utf8')).split('\n').filter(Boolean)

const batch = await thunder.jobs.submitBankBatch(
    payloads.map((payload) => ({ payload, checkDuplicate: true })),
    { callbackUrl: 'https://example.com/webhooks/thunder' },
)

// เว็บฮุคจะได้รับผลทุกใบ หรือจะรอผลของแต่ละงานตรงนี้ก็ได้
for (const { jobId } of batch.jobs) {
    const job = await thunder.jobs.waitForJob(jobId)
    console.log(jobId, job.status, job.result?.status, job.result?.data?.amountInSlip)
}
```

| เมธอด | ใช้ทำอะไร |
| --- | --- |
| `jobs.submitBank(payload, options)` | ส่งสลิปหนึ่งใบ รับตัวเลือกเหมือน `verify` และเพิ่ม `callbackUrl` |
| `jobs.submitBankBatch(slips, { callbackUrl })` | ส่งสลิป 1 ถึง 100 ใบในคำขอเดียว แต่ละใบตั้งตัวเลือกของตัวเองได้ |
| `jobs.submitBankMany(slips, { callbackUrl })` | ส่งสลิปกี่ใบก็ได้ โดยแบ่งเป็นชุดละ 100 ใบแล้วส่งทีละชุด |
| `jobs.get(jobId)` | ดึงสถานะงาน และผลการตรวจเมื่องานเสร็จ |
| `jobs.waitForJob(jobId, options)` | เช็กงานทุก `interval` มิลลิวินาที (ค่าเริ่มต้น 2000) จนงานเป็น `done` หรือ `failed` รอนานสุด `timeout` มิลลิวินาที (ค่าเริ่มต้น 600000 หรือ 10 นาที) |

### สร้างคิวอาร์รับเงิน

API สร้างคิวอาร์ PromptPay และคิวอาร์ชำระบิลให้ลูกค้าสแกนจ่ายได้ การสร้างคิวอาร์ไม่ใช้โควต้า `amount` มีหน่วยเป็นบาท ใส่ได้ตั้งแต่ 0.01 ถึง 9,999,999,999.99 ทศนิยมไม่เกิน 2 ตำแหน่ง ถ้าไม่ใส่ ผู้จ่ายจะกรอกยอดเอง

```ts
import { writeFile } from 'node:fs/promises'
import { Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

// PromptPay เข้าเบอร์โทร ยอด 250 บาท
const promptPay = await thunder.v1.generateQr({ type: 'PROMPTPAY', msisdn: '0812345678', amount: 250 })
await writeFile('promptpay.png', promptPay.imageBytes())

// ชำระบิลเข้า Biller ID ของคุณ ใช้เลขใบแจ้งหนี้เป็น Ref1
const bill = await thunder.v1.generateQr({
    type: 'PROMPTPAY',
    billerId: '010555512345601',
    ref1: 'INV1001',
    amount: 1500,
})
await writeFile('bill.png', bill.imageBytes())
```

| `type` | ฟิลด์ที่ต้องใส่ | ฟิลด์ที่ใส่หรือไม่ก็ได้ |
| --- | --- | --- |
| `PROMPTPAY` | อย่างใดอย่างหนึ่ง: `msisdn` (เบอร์โทร), `natId` (เลขบัตรประชาชนหรือเลขผู้เสียภาษี), `eWalletId` หรือ `billerId` | `amount` และใส่ `ref1`, `ref2` ได้เมื่อใช้ `billerId` |
| `KSHOP` | `ref1` คือรหัสร้าน ขึ้นต้นด้วย `KB` ตามด้วยตัวเลข 12 หลัก | `amount` |
| `MAE_MANEE` | `ref1` คือรหัสร้าน 15 หลัก | `amount` |
| `TUNGNGERN` | `ref1` คือรหัสร้านค้า และ `merchantName` คือชื่อร้านภาษาอังกฤษ | `amount` |

type `BILL_PAYMENT` แบบเดิมยังใช้ได้ ถ้าใช้ `billerId` เดียวกันจะได้คิวอาร์เดียวกับ `PROMPTPAY` ส่วน type `QrType` รวมทั้งห้า type ที่ API รับ

### API v1 แบบเดิม

ใช้ `thunder.v1` เฉพาะระบบที่เชื่อมกับ API v1 อยู่แล้ว โค้ดใหม่ควรใช้เมธอด v2 ด้านบน เมธอดของ v1 คืนข้อมูลสลิปโดยตรง และเมื่อใส่ `checkDuplicate: true` แล้วเจอสลิปซ้ำจะโยน `DuplicateSlipError`

```ts
import { DuplicateSlipError, Thunder } from '@thunder-solution/sdk'

const thunder = new Thunder()

try {
    const slip = await thunder.v1.verifyBankByImage('./slip.jpg', { checkDuplicate: true })
    console.log(slip.transRef, slip.amount.amount)
} catch (error) {
    if (!(error instanceof DuplicateSlipError)) throw error
    console.log('สลิปนี้เคยใช้แล้ว วันที่โอน:', error.slip?.date)
}
```

API v1 ยังมี `verifyBankByPayload`, `verifyBankByUrl`, `verifyBankByBase64`, `verifyTruemoneyByImage` และ `getMe`

### Promise, timeout และการยกเลิก

ทุกเมธอดคืน promise จึงตรวจสลิปหลายใบพร้อมกันได้ ส่ง `signal` เพื่อยกเลิกการเรียกหรือกำหนดเวลาสูงสุด อย่ายิงพร้อมกันมากเกินไป เพราะ API จำกัดจำนวนคำขอต่อช่วงเวลา

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
    else console.log(files[index], 'ตรวจไม่สำเร็จ:', outcome.reason)
})
```

<a id="the-result-object"></a>

## ผลการตรวจ

การตรวจแบบ v2 คืนผลของเงื่อนไขที่คุณขอไว้ที่ชั้นบนสุด และข้อมูลสลิปตามที่ธนาคารส่งมาไว้ใน `rawSlip` ดูโครงสร้างเต็มได้ที่[เอกสาร API](https://document.thunder.in.th/th/v2/verify/bank/)

### สลิปธนาคาร

| ฟิลด์ | ชนิด | ความหมาย | ตัวอย่าง |
| --- | --- | --- | --- |
| `amountInSlip` | `number` | ยอดเงินที่โอน หน่วยเป็นบาท | `1500` |
| `isAmountMatched` | `boolean` | ยอดเงินตรงกับ `matchAmount` หรือไม่ มีเฉพาะเมื่อใส่ `matchAmount` | `true` |
| `amountInOrder` | `number` | ค่า `matchAmount` ที่ส่งไป มีเฉพาะเมื่อใส่ `matchAmount` | `1500` |
| `matchedAccount` | `object` หรือ `null` | บัญชีรับเงินของคุณที่สลิปโอนเข้า หรือ `null` ถ้าไม่ตรงบัญชีไหน มีเฉพาะเมื่อใส่ `matchAccount` | `{ bankNumber: '123-4-56789-0', ... }` |
| `isDuplicate` | `boolean` | สลิปนี้เคยถูกตรวจแล้วหรือไม่ มีเฉพาะเมื่อใส่ `checkDuplicate` | `false` |
| `remark` | `string` | ค่า `remark` ที่ส่งไป มีเฉพาะเมื่อส่ง | `'Order 1001'` |
| `rawSlip.transRef` | `string` | เลขอ้างอิงรายการของธนาคาร แต่ละรายการโอนไม่ซ้ำกัน เก็บไว้เพื่อกันสลิปซ้ำได้ | `'68370160657749I376388B35'` |
| `rawSlip.date` | `string` | เวลาที่โอน รูปแบบ ISO 8601 พร้อมเขตเวลาไทย | `'2024-01-15T14:30:00+07:00'` |
| `rawSlip.amount.amount` | `number` | ยอดเงิน หน่วยเป็นบาท | `1500` |
| `rawSlip.fee` | `number` | ค่าธรรมเนียม เมื่อธนาคารแจ้งมา | `0` |
| `rawSlip.sender.bank` | `object` | ธนาคารผู้โอน: `id` (รหัสธนาคาร), `name` และ `short` | `{ id: '004', name: 'กสิกรไทย', short: 'KBANK' }` |
| `rawSlip.sender.account.name` | `object` | ชื่อผู้โอนภาษาไทย (`th`) และอังกฤษ (`en`) เมื่อธนาคารแสดง | `{ th: 'นาย ผู้โอน ทดสอบ', en: 'MR. SENDER TEST' }` |
| `rawSlip.sender.account.bank` | `object` | เลขบัญชีผู้โอน ธนาคารปิดบางหลักไว้ | `{ type: 'BANKAC', account: '123-4-xxxxx-5' }` |
| `rawSlip.receiver.bank` | `object` | ธนาคารผู้รับ รูปแบบเดียวกับผู้โอน | `{ id: '014', name: 'ไทยพาณิชย์', short: 'SCB' }` |
| `rawSlip.receiver.account.name` | `object` | ชื่อผู้รับ | `{ th: 'บริษัท ตัวอย่าง จำกัด' }` |
| `rawSlip.receiver.account.bank` | `object` | เลขบัญชีผู้รับ ปิดบางหลักไว้ | `{ type: 'BANKAC', account: 'xxx-x-x5678-x' }` |
| `rawSlip.receiver.account.proxy` | `object` | PromptPay ที่ใช้รับเงิน เมื่อโอนผ่าน PromptPay | `{ type: 'MSISDN', account: '08xxxxxxxx89' }` |
| `rawSlip.ref1`, `rawSlip.ref2`, `rawSlip.ref3` | `string` | เลขอ้างอิงของการชำระบิล เป็นค่าว่างสำหรับการโอนทั่วไป | `''` |

<a id="truemoney-wallet-receipt"></a>

### สลิป TrueMoney Wallet

ฟิลด์ชั้นบนสุดเหมือนสลิปธนาคาร ส่วน `rawSlip` มีข้อมูลดังนี้

| ฟิลด์ | ชนิด | ความหมาย | ตัวอย่าง |
| --- | --- | --- | --- |
| `rawSlip.transactionId` | `string` | เลขรายการของ TrueMoney | `'50012345678901'` |
| `rawSlip.date` | `string` | เวลาที่ชำระ รูปแบบ ISO 8601 | `'2026-10-26T14:30:00+07:00'` |
| `rawSlip.amount` | `number` | ยอดเงิน หน่วยเป็นบาท | `500` |
| `rawSlip.sender.name` | `string` | ชื่อผู้โอน | `'นาย ผู้โอน ทดสอบ'` |
| `rawSlip.receiver.name` | `string` | ชื่อผู้รับ | `'นาย รับเงิน ทดสอบ'` |
| `rawSlip.receiver.phone` | `string` | เบอร์โทรผู้รับ ปิดบางหลักไว้ | `'08x-xxx-4567'` |

ผลการตรวจทุกตัวมี property `meta` ที่เก็บ HTTP status, `requestId`, ตัวนับ rate limit และ header ของ response ค่านี้ไม่ได้เป็นส่วนของข้อมูล `JSON.stringify(result)` จึงไม่รวม `meta` ไว้

## การตั้งค่า

ส่งตัวเลือกเข้า `new Thunder({ ... })` ตัวเลือกที่ไม่ได้ใส่จะอ่านจากตัวแปร environment ถ้าไม่มีก็ใช้ค่าเริ่มต้น

| ตัวเลือก | ตัวแปร environment | ค่าเริ่มต้น | ใช้ทำอะไร |
| --- | --- | --- | --- |
| `apiKey` | `THUNDER_API_KEY` | ไม่มี | API key ของคุณ ถ้าไม่มี key เลย `new Thunder()` จะโยน `InputError` |
| ไม่มีตัวเลือก | `THUNDER_API_KEY_FILE` | ไม่มี | path ของไฟล์ที่เก็บ API key เช่น Docker secret หรือ Kubernetes secret ใช้เมื่อไม่มีทั้ง `apiKey` และ `THUNDER_API_KEY` |
| `timeout` | ไม่มีตัวแปร | `30000` | เวลาสูงสุดของการส่งคำขอแต่ละครั้ง หน่วยมิลลิวินาที |
| `maxRetries` | ไม่มีตัวแปร | `2` | จำนวนครั้งที่ลองใหม่เมื่อคำขอล้มเหลว ใส่ `0` เพื่อปิด |
| `fetch` | ไม่มีตัวแปร | `fetch` ของ runtime | ฟังก์ชันที่ SDK ใช้ส่งคำขอ |
| `v2BaseUrl` | `THUNDER_V2_BASE_URL` | `https://api.thunder.in.th/v2` | ที่อยู่ของ API v2 |
| `v1BaseUrl` | `THUNDER_V1_BASE_URL` | `https://api.thunder.in.th/v1` | ที่อยู่ของ API v1 |
| ไม่มีตัวเลือก | `THUNDER_WEBHOOK_SECRET` | ไม่มี | Webhook Secret ของสาขา [ฟังก์ชันตรวจเว็บฮุค](#webhooks)ใช้ค่านี้เมื่อไม่ได้ส่ง secret เข้าไป |

ทุกเมธอดรับ `timeout`, `maxRetries` และ `signal` สำหรับการเรียกครั้งนั้นได้ด้วย เมธอดตรวจสลิปรับไว้ใน object เดียวกับตัวเลือกการตรวจ เช่น `verify.bankByImage(file, { checkDuplicate: true, timeout: 10_000 })`

### ใช้ HTTP client ของคุณเอง

ส่ง `fetch` ของคุณเข้าไปได้ เช่น เพื่อเก็บ log ส่งผ่าน proxy หรือบันทึกคำขอในเทสต์ ฟังก์ชันนี้ได้รับ URL กับตัวเลือกของคำขอ และต้องคืน `Response`

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

client ไม่ได้เปิด connection ของตัวเอง จึงไม่ต้องปิดเมื่อเลิกใช้ ถ้า `fetch` ที่ส่งเข้าไปมี connection pool ของตัวเอง เช่น undici `Agent` ให้ปิด pool นั้นตอนแอปหยุดทำงาน

<a id="error-handling"></a>

## การจัดการ error

error ทุกตัวที่ SDK โยนเป็น `ThunderError` ส่วน error ที่มาจาก API เป็น `ApiError` ซึ่งมี `status`, `code` (เช่น `SLIP_NOT_FOUND`), `message`, `requestId` และ `retryAfter` บางคลาสเป็นคลาสย่อยของอีกคลาส ได้แก่ `QuotaExceededError` เป็น `PermissionDeniedError` ส่วน `InvalidImageError`, `InvalidUrlError` และ `DuplicateSlipError` เป็น `InvalidRequestError` ส่วน `SlipNotFoundError` และ `SlipPendingError` เป็น `NotFoundError` ส่วน `ServiceUnavailableError` เป็น `ServerError` และ `RequestTimeoutError` เป็น `NetworkError`

| คลาส error | HTTP status | เกิดเมื่อ | ควรทำอย่างไร |
| --- | --- | --- | --- |
| `AuthenticationError` | 401 | ไม่มี API key, key ผิด หรือ key ถูกยกเลิกแล้ว | ตรวจ key ที่ส่งเข้าไปหรือ `THUNDER_API_KEY` ถ้าจำเป็นให้สร้าง key ใหม่ใน developer portal |
| `PermissionDeniedError` | 403 | key ถูกต้องแต่ไม่มีสิทธิ์ทำคำขอนี้ เช่น สาขาถูกปิด แพ็กเกจหมดอายุ หรือ IP ของเซิร์ฟเวอร์ไม่อยู่ในรายการที่อนุญาต | ดู `error.code` แล้วแก้การตั้งค่านั้นใน developer portal |
| `QuotaExceededError` | 403 | โควต้าหมด คำขอนี้ยังไม่ถูกหักโควต้า | เติมโควต้าหรือเปลี่ยนแพ็กเกจ แล้วส่งคำขอใหม่ |
| `InvalidRequestError` | 400 | API ไม่รับค่าบางอย่างในคำขอ เช่น ข้อความคิวอาร์หรือค่าตัวเลือก | แก้ค่าที่ `error.message` บอก ส่งคำขอเดิมซ้ำจะได้ error เดิม |
| `InvalidImageError` | 400 | อ่านคิวอาร์ของสลิปในรูปไม่ได้ ชนิดไฟล์ไม่รองรับ หรือไฟล์ใหญ่เกินไป | ขอให้ลูกค้าส่งรูป JPEG, PNG, GIF หรือ WebP ที่ชัดและไม่เกิน 4 MB |
| `InvalidUrlError` | 400 | URL ของรูปหรือ `callbackUrl` ชี้ไปที่ที่อยู่ภายใน ไม่ได้ใช้ http หรือ https หรือเปิดไม่ได้ | ใช้ URL แบบ https ที่เปิดได้จากภายนอก |
| `DuplicateSlipError` | 400 | เฉพาะ API v1 ที่ใส่ `checkDuplicate: true`: สลิปนี้เคยถูกตรวจแล้ว `error.slip` คือผลการตรวจครั้งแรก | ถือว่าได้รับยอดนี้ไปแล้ว อย่ายืนยันซ้ำ |
| `NotFoundError` | 404 | ไม่พบบัญชีธนาคาร งาน หรือรายการที่ขอ | ตรวจ ID ที่ส่งเข้าไป |
| `SlipNotFoundError` | 404 | ธนาคารไม่มีรายการโอนที่ตรงกับสลิปนี้ | อย่ารับยอด และขอสลิปตัวจริงจากลูกค้า |
| `SlipPendingError` | 404 | ธนาคารยังไม่เผยแพร่รายการโอนนี้ มักเกิดกับสลิปธนาคารกรุงเทพที่เพิ่งโอน | รอประมาณหนึ่งนาทีแล้วตรวจใหม่ |
| `ConflictError` | 409 | บัญชีรับเงินที่กำลังเพิ่มมีอยู่แล้ว | ใช้บัญชีเดิม หาได้ด้วย `bankAccounts.listAll()` |
| `RateLimitError` | 429 | ส่งคำขอถี่เกินไป `error.retryAfter` บอกว่าต้องรอกี่วินาที | ลดจำนวนคำขอที่ส่งพร้อมกัน SDK ลองใหม่ให้แล้วก่อนโยน error นี้ |
| `ServerError` | 500, 502, 504; 5xx อื่นยกเว้น 503 | เกิดปัญหาที่ฝั่ง Thunder | ลองใหม่ภายหลัง ถ้ายังเกิดซ้ำให้ติดต่อซัพพอร์ตพร้อม `error.requestId` |
| `ServiceUnavailableError` | 503 | บริการไม่พร้อมใช้งานชั่วคราว เช่น ช่วงต่ออายุโควต้า | ลองใหม่ในอีกไม่กี่นาที |
| `ApiError` | 4xx อื่น ๆ | API ตอบ error ด้วย status ที่ไม่มีคลาสเฉพาะ | เก็บ log `status`, `code` และ `requestId` ถ้ายังเกิดอยู่ให้ติดต่อซัพพอร์ต |
| `NetworkError` | เครือข่าย | ไม่ได้รับคำตอบเพราะ DNS การเชื่อมต่อ หรือ TLS ล้มเหลว | ตรวจเครือข่ายหรือ proxy แล้วลองใหม่ |
| `RequestTimeoutError` | เครือข่าย | ไม่ได้รับคำตอบภายใน `timeout` | ลองใหม่หรือเพิ่ม `timeout` การตรวจสลิปครั้งนั้นอาจถูกนับโควต้าไปแล้ว |
| `InputError` | ก่อนส่งคำขอ | SDK เจอปัญหาก่อนส่ง เช่น ไม่มี API key ข้อความคิวอาร์ว่าง รูปเกิน 4 MB หรือไฟล์ไม่ใช่รูป `error.code` บอกสาเหตุ | แก้ค่าที่ส่งเข้าไป |
| `WebhookSignatureError` | ก่อนส่งคำขอ | เว็บฮุคไม่มีลายเซ็น หรือลายเซ็นไม่ตรง | ตอบเว็บฮุคนั้นด้วย status 400 |
| `JobWaitTimeoutError` | ก่อนส่งคำขอ | `waitForJob` รอจนครบ `timeout` แล้ว `error.lastJob` คือสถานะล่าสุดที่เห็น | รอนานขึ้น หรือรอผลทางเว็บฮุคแทน |
| `BatchSubmitError` | ก่อนส่งคำขอ | `submitBankMany` หยุดกลางทาง `error.submitted` คือชุดที่ส่งไปแล้ว และ `error.failedChunk` คือชุดที่ล้มเหลว | ส่งชุดที่ล้มเหลวและชุดถัดไปใหม่ ชุดที่ส่งไปแล้วยังทำงานต่อ |

ตัวอย่างนี้ตรวจสลิปที่ลูกค้าอัปโหลดตอนชำระเงิน แล้วแปลง error แต่ละแบบเป็นข้อความที่แสดงให้ลูกค้าเห็น

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
        if (result.isDuplicate) return 'สลิปนี้เคยใช้แล้ว'
        if (!result.isAmountMatched) return `สลิปนี้โอน ${result.amountInSlip} บาท ยอดไม่ตรงกับออเดอร์`
        if (result.matchedAccount === null) return 'สลิปนี้ไม่ได้โอนเข้าบัญชีของร้าน'
        return 'ได้รับชำระเงินแล้ว'
    } catch (error) {
        if (error instanceof SlipNotFoundError) return 'ไม่พบรายการโอนนี้ที่ธนาคาร'
        if (error instanceof SlipPendingError) return 'ธนาคารยังประมวลผลรายการนี้อยู่ ลองใหม่ในอีกหนึ่งนาที'
        if (error instanceof InvalidImageError) return 'กรุณาอัปโหลดรูปหรือภาพหน้าจอสลิปที่ชัดเจน'
        if (error instanceof QuotaExceededError || error instanceof RateLimitError) {
            console.error('Thunder limit reached', error.code, error.requestId)
            return 'ตอนนี้ยังตรวจสลิปไม่ได้ กรุณาลองใหม่อีกครั้ง'
        }
        if (error instanceof ApiError) {
            console.error('Thunder error', error.status, error.code, error.requestId)
            return 'ตรวจสลิปไม่สำเร็จ กรุณาลองใหม่'
        }
        throw error
    }
}

const upload = new File([await readFile('./slip.jpg')], 'slip.jpg', { type: 'image/jpeg' })
console.log(await checkPayment(upload, 1500))
```

### SDK ลองใหม่ให้เมื่อไร

SDK ลองส่งคำขอที่ล้มเหลวใหม่ได้สูงสุด `maxRetries` ครั้ง (ค่าเริ่มต้น 2 ครั้ง) ก่อนลองใหม่ครั้งแรกจะรอประมาณครึ่งวินาที แล้วเพิ่มเวลารอเป็นสองเท่าทุกครั้ง ไม่เกิน 8 วินาที ถ้า API ส่ง `Retry-After` มา SDK จะรอตามนั้นแทน แต่ถ้าต้องรอนานกว่า 60 วินาทีจะโยน error ทันที

| คำขอ | ลองใหม่เมื่อ | ไม่ลองใหม่เมื่อ |
| --- | --- | --- |
| การอ่านข้อมูลและการผูกบัญชี: `getInfo`, `banks.list`, `bankAccounts.list`, `listAll`, `get` และ `link`, `jobs.get`, `v1.getMe`, `v1.generateQr` | เครือข่ายล้มเหลว หมดเวลา หรือ API ตอบ 429, 500, 502, 503 หรือ 504 | API ตอบ 400, 401, 403, 404 หรือ 409 |
| การตรวจสลิปและการส่งงานเบื้องหลัง ซึ่งใช้โควต้า | API ตอบ 429 หรือเชื่อมต่อไม่สำเร็จก่อนคำขอจะออกจากเซิร์ฟเวอร์ | คำขอส่งออกไปแล้ว แล้วหมดเวลาหรือได้คำตอบ 5xx |
| การแก้ไขบัญชีรับเงิน: `create`, `update` และ `unlink` | API ตอบ 429 หรือเชื่อมต่อไม่สำเร็จก่อนคำขอจะออกจากเซิร์ฟเวอร์ | คำขอส่งออกไปแล้ว แล้วหมดเวลาหรือได้คำตอบ 5xx |

การตรวจสลิปที่ส่งถึง API แล้วอาจถูกนับโควต้าไปแล้ว แม้จะไม่ได้รับคำตอบกลับมา การลองใหม่อาจทำให้ถูกหักโควต้าซ้ำ SDK จึงให้คุณเป็นคนตัดสินใจเอง

<a id="webhooks"></a>

## เว็บฮุค

เมื่องานเบื้องหลังเสร็จ Thunder จะส่งคำขอ POST ไปที่ `callbackUrl` ของคุณ ถ้าสาขาตั้ง Webhook Secret ไว้ คำขอจะมี header `X-Thunder-Signature` ให้ตรวจลายเซ็นกับ body ดิบก่อนแปลงหรือเชื่อข้อมูลใด ๆ ในนั้น

เซิร์ฟเวอร์นี้ใช้แค่ Node.js

```ts
import { createServer } from 'node:http'
import {
    constructWebhookEvent,
    InputError,
    WEBHOOK_SIGNATURE_HEADER,
    WebhookSignatureError,
} from '@thunder-solution/sdk'

if (!process.env.THUNDER_WEBHOOK_SECRET) throw new Error('กรุณาตั้งค่า THUNDER_WEBHOOK_SECRET')

createServer(async (request, response) => {
    try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk as Buffer)
        const rawBody = Buffer.concat(chunks)
        const signature = request.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()]

        // ใช้ secret จาก THUNDER_WEBHOOK_SECRET
        const event = constructWebhookEvent(rawBody, signature)
        if (event.status === 'success') {
            console.log('ตรวจผ่าน', event.jobId, event.data?.rawSlip.transRef, event.data?.amountInSlip)
        } else {
            console.log('ตรวจไม่ผ่าน', event.jobId, event.status, event.error?.code)
        }
        response.writeHead(200).end('ok')
    } catch (error) {
        if (error instanceof WebhookSignatureError || error instanceof InputError) {
            // ไม่มีลายเซ็น ลายเซ็นไม่ตรง หรือ body ที่ลงลายเซ็นมาไม่ใช่ event ของเว็บฮุค
            response.writeHead(400).end('invalid webhook')
        } else {
            console.error('จัดการเว็บฮุคไม่สำเร็จ', error)
            response.writeHead(500).end('error')
        }
    }
}).listen(3000)
```

เซิร์ฟเวอร์นี้ตอบ 400 เมื่อไม่มีลายเซ็นหรือลายเซ็นไม่ตรง และเมื่อ body ที่ลงลายเซ็นมาไม่ใช่ event ของเว็บฮุค และตอบ 500 เมื่อเกิดปัญหาอื่น Thunder จะส่ง event เดิมอีกครั้งเมื่อได้คำตอบที่ไม่ใช่ 2xx

ถ้าใช้ Express ให้ใส่ `express.raw({ type: 'application/json' })` ที่ route ของเว็บฮุค เพื่อให้ `req.body` เป็น body ดิบแบบ `Buffer` แล้วส่ง `req.body` กับ `req.get(WEBHOOK_SIGNATURE_HEADER)` เข้า `constructWebhookEvent` อย่าใช้ `express.json()` กับ route นี้ เพราะการแปลง JSON แล้วแปลงกลับเป็นข้อความจะทำให้ bytes เปลี่ยน แล้วลายเซ็นจะไม่ตรง

| ฟังก์ชัน | ใช้ทำอะไร |
| --- | --- |
| `constructWebhookEvent(rawBody, header, secret?)` | ตรวจลายเซ็นแล้วคืน event ที่แปลงแล้ว โยน `WebhookSignatureError` เมื่อไม่มีลายเซ็นหรือลายเซ็นไม่ตรง และโยน `InputError` เมื่อ body ไม่ใช่ JSON object ที่มี `jobId`, `status` และ `timestamp` |
| `verifyWebhookSignature(rawBody, header, secret?)` | คืน `true` เมื่อลายเซ็นตรง และ `false` เมื่อไม่ตรง |
| `parseWebhookEvent(rawBody)` | แปลง event โดยไม่ตรวจลายเซ็น และโยน `InputError` เมื่อ body ไม่ใช่ event ใช้หลังจากตรวจลายเซ็นเองแล้วเท่านั้น |

ถ้าไม่ส่ง `secret` จะใช้ค่าจาก `THUNDER_WEBHOOK_SECRET` ตอบกลับด้วย status 2xx ภายใน 5 วินาที Thunder อาจส่ง event เดิมมาซ้ำได้ ให้ใช้ `jobId` ข้าม event ที่จัดการไปแล้ว

## ความปลอดภัยและข้อมูลส่วนบุคคล

- เก็บ API key ไว้ฝั่งเซิร์ฟเวอร์เท่านั้น อย่าใส่ในหน้าเว็บ แอปมือถือ หรือ repository สาธารณะ เพราะใครได้ key ไปก็ใช้โควต้าของคุณได้
- อ่าน key จาก `THUNDER_API_KEY` หรือไฟล์ secret แทนการเขียนลงในโค้ด
- SDK ไม่ใส่ API key ลงในข้อความ error จึงเก็บ log ของ error ได้อย่างปลอดภัย
- สลิปมีชื่อ เลขบัญชี และยอดเงิน ซึ่งเป็นข้อมูลส่วนบุคคล เก็บเฉพาะที่จำเป็น ดูแลเหมือนข้อมูลลูกค้าอื่น ๆ และปฏิบัติตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)
- ตรวจลายเซ็นของเว็บฮุคทุกครั้งก่อนนำข้อมูลไปใช้

## เวอร์ชันและนโยบายการรองรับ

- การออกเวอร์ชันใช้ [semantic versioning](https://semver.org) เวอร์ชัน minor และ patch จะไม่ทำให้โค้ดเดิมพัง การเปลี่ยนแปลงที่กระทบโค้ดเดิมจะออกเป็นเวอร์ชัน major ใหม่ พร้อมวิธีอัปเกรดใน changelog
- SDK รองรับ Node.js เวอร์ชันที่โปรเจกต์ Node.js ยังดูแลอยู่ เมื่อ Node.js เวอร์ชันใดหมดอายุการดูแล SDK เวอร์ชันถัดไปอาจเลิกรองรับเวอร์ชันนั้น และจะแจ้งไว้ใน changelog
- [CHANGELOG.md](CHANGELOG.md) และ[หน้า releases](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/releases) รวบรวมทุกเวอร์ชันและสิ่งที่เปลี่ยน

## ตัวอย่างและเอกสาร

- โฟลเดอร์ [`examples`](examples) มีโปรแกรมที่รันได้จริงครบทุกเมธอด clone repository นี้ รัน `bun install` และ `bun run build` แล้วรันตัวอย่าง เช่น `THUNDER_API_KEY="your-api-key" node examples/verify-bank-image.ts ./slip.jpg` ถ้าไม่ใส่ argument ตัวอย่างจะบอกวิธีเรียกที่ถูกต้อง
- [คู่มือ SDK](https://document.thunder.in.th/th/sdk/javascript) อธิบาย SDK นี้ในเอกสารของ Thunder
- [เอกสาร API](https://document.thunder.in.th) อธิบายทุก endpoint ทุกฟิลด์ และ[รหัส error](https://document.thunder.in.th/th/reference/error-codes)

## ช่วยเหลือ

เรื่องบัญชี โควต้า หรือการชำระเงิน ติดต่อผ่าน[หน้าติดต่อเรา](https://developer.thunder.in.th/contact) พร้อม request id ถ้ามี แจ้งบั๊กหรือขอฟีเจอร์ได้ใน [issues](https://github.com/THUNDER-SOLUTION-CO-LTD/sdk-js/issues) ห้ามแนบ API key หรือรูปสลิปจริง

## ร่วมพัฒนา

อ่านวิธีติดตั้งเครื่องมือ รันทดสอบ และส่ง pull request ใน [CONTRIBUTING.md](CONTRIBUTING.md) ผู้ดูแลการออกเวอร์ชันอ่าน [RELEASING.md](RELEASING.md)

## แจ้งปัญหาความปลอดภัย

แจ้งแบบส่วนตัวตาม [SECURITY.md](SECURITY.md) หรือติดต่อผ่าน[หน้าติดต่อ](https://developer.thunder.in.th/contact) ห้ามแจ้งช่องโหว่ใน issue สาธารณะ

## สัญญาอนุญาต

[MIT](LICENSE). Copyright (c) 2026 Thunder Solution Co., Ltd.
