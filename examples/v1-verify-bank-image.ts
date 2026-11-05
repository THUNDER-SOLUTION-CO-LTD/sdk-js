// v1: verifies a bank slip image.
// Usage: node examples/v1-verify-bank-image.ts <image file>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const file = arg(0, '<image file>')

await run(() => new Client().v1.verifyBankByImage(file))
