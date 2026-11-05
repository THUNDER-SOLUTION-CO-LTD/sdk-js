// Queues one slip for async verification. The result is posted to the callback URL.
// Usage: node examples/jobs-submit-bank.ts <QR payload> <https callback URL>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const usage = '<QR payload> <https callback URL>'
const payload = arg(0, usage)
const callbackUrl = arg(1, usage)

await run(() => new Client().jobs.submitBank(payload, { callbackUrl, checkDuplicate: true }))
