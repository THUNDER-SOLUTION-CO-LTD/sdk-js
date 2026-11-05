// Verifies a bank slip from the text of its QR code, and checks for a duplicate.
// Usage: node examples/verify-bank-payload.ts <QR payload> [expected amount]
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const payload = arg(0, '<QR payload> [expected amount]')
const amount = process.argv[3]

await run(async () => {
    const result = await new Client().verify.bankByPayload(payload, {
        checkDuplicate: true,
        ...(amount ? { matchAmount: Number(amount) } : {}),
    })
    console.log('transRef:', result.rawSlip.transRef, 'duplicate:', result.isDuplicate)
    return result
})
