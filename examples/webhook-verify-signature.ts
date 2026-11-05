// Checks a webhook signature against the raw body. No client or API key needed. The secret
// comes from the second argument, else the webhook secret env variable.
// Usage: node examples/webhook-verify-signature.ts <body file> <signature header value> [secret]
import { readFile } from 'node:fs/promises'
import { verifyWebhookSignature } from '@thunder-solution/sdk'
import { arg } from './util.ts'

const usage = '<body file> <signature header value> [secret]'
const rawBody = await readFile(arg(0, usage))
const header = arg(1, usage)

const valid = verifyWebhookSignature(rawBody, header, process.argv[4])
console.log(valid ? 'valid signature' : 'invalid signature')
process.exitCode = valid ? 0 : 1
