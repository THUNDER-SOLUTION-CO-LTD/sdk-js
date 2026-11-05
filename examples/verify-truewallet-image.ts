// Verifies a TrueMoney Wallet slip image.
// Usage: node examples/verify-truewallet-image.ts <image file>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const file = arg(0, '<image file>')

await run(async () => {
    const result = await new Client().verify.truewalletByImage(file, { checkDuplicate: true })
    console.log('transaction:', result.rawSlip.transactionId, 'amount:', result.rawSlip.amount)
    return result
})
