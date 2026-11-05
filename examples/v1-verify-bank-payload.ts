// v1: verifies a bank slip from its QR payload. A slip you verified before throws
// DuplicateSlipError carrying the original slip (v1 does not charge for it).
// Usage: node examples/v1-verify-bank-payload.ts <QR payload>
import { Client, DuplicateSlipError } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const payload = arg(0, '<QR payload>')

await run(async () => {
    try {
        return await new Client().v1.verifyBankByPayload(payload, { checkDuplicate: true })
    } catch (error) {
        if (error instanceof DuplicateSlipError) return { duplicateOf: error.slip }
        throw error
    }
})
