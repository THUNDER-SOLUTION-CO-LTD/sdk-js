// Verifies a bank slip image that the API downloads from a public URL.
// Usage: node examples/verify-bank-url.ts <image URL>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const url = arg(0, '<image URL>')

await run(() => new Client().verify.bankByUrl(url, { remark: 'example' }))
