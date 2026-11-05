// Queues 1 to 100 slips in one call, one job per slip.
// Usage: node examples/jobs-submit-bank-batch.ts <https callback URL> <QR payload> [QR payload ...]
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const callbackUrl = arg(0, '<https callback URL> <QR payload> [QR payload ...]')
arg(1, '<https callback URL> <QR payload> [QR payload ...]')
const slips = process.argv.slice(3).map((payload) => ({ payload, checkDuplicate: true }))

await run(() => new Client().jobs.submitBankBatch(slips, { callbackUrl }))
