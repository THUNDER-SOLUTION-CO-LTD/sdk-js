// v1: generates a PromptPay QR for a phone number and writes the PNG. Uses no quota.
// Usage: node examples/v1-generate-qr.ts <phone number> [amount] [output.png]
import { writeFile } from 'node:fs/promises'
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const msisdn = arg(0, '<phone number> [amount] [output.png]')
const amount = process.argv[3] ? Number(process.argv[3]) : undefined
const out = process.argv[4] ?? 'qr.png'

await run(async () => {
    const qr = await new Client().v1.generateQr({
        type: 'PROMPTPAY',
        msisdn,
        ...(amount === undefined ? {} : { amount }),
    })
    await writeFile(out, qr.imageBytes())
    return { payload: qr.payload, mime: qr.mime, written: out }
})
