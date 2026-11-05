// Verifies a TrueMoney Wallet slip image from a public URL (up to 255 characters).
// Usage: node examples/verify-truewallet-url.ts <image URL>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const url = arg(0, '<image URL>')

await run(() => new Client().verify.truewalletByUrl(url))
