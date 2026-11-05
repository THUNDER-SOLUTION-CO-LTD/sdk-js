// Queues any number of slips from a text file (one QR payload per line), 100 per call.
// Usage: node examples/jobs-submit-bank-many.ts <payload file> <https callback URL>
import { readFile } from 'node:fs/promises'
import { BatchSubmitError, Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const usage = '<payload file> <https callback URL>'
const lines = (await readFile(arg(0, usage), 'utf8')).split(/\r?\n/).filter(Boolean)
const callbackUrl = arg(1, usage)

await run(async () => {
    try {
        const batches = await new Client().jobs.submitBankMany(
            lines.map((payload) => ({ payload })),
            { callbackUrl },
        )
        return batches.map((batch) => ({ batchId: batch.batchId, jobs: batch.jobs.length }))
    } catch (error) {
        if (error instanceof BatchSubmitError) {
            console.error(`chunk ${error.failedChunk} failed; ${error.submitted.length} accepted`)
        }
        throw error
    }
})
