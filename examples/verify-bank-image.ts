// Verifies a bank slip image (JPEG, PNG, GIF or WebP, up to 4 MB) and matches the receiver
// against your registered bank accounts.
// Usage: node examples/verify-bank-image.ts <image file>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const file = arg(0, '<image file>')

await run(async () => {
    const result = await new Client().verify.bankByImage(file, { matchAccount: true })
    console.log('matched account:', result.matchedAccount)
    return result
})
