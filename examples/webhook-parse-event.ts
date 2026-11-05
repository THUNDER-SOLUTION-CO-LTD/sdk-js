// Parses a webhook body into a typed event, without checking the signature.
// Usage: node examples/webhook-parse-event.ts <body file>
import { readFile } from 'node:fs/promises'
import { parseWebhookEvent } from '@thunder-solution/sdk'
import { arg } from './util.ts'

const event = parseWebhookEvent(await readFile(arg(0, '<body file>')))
console.log(event.jobId, event.status, event.data?.rawSlip.transRef ?? event.error?.code ?? '')
