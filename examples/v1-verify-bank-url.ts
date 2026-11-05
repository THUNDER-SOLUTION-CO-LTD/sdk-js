// v1: verifies a bank slip image that the API downloads from a public URL.
// Usage: node examples/v1-verify-bank-url.ts <image URL>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const url = arg(0, '<image URL>')

await run(() => new Client().v1.verifyBankByUrl(url))
