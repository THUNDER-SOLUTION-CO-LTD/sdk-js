// Polls a job every 2 seconds until it is done or failed, for up to 10 minutes.
// Usage: node examples/jobs-wait-for-job.ts <job id>
import { Client, JobWaitTimeoutError } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const jobId = arg(0, '<job id>')

await run(async () => {
    try {
        const job = await new Client().jobs.waitForJob(jobId, { interval: 2_000, timeout: 600_000 })
        console.log('status:', job.status, 'result:', job.result?.status)
        return job
    } catch (error) {
        if (error instanceof JobWaitTimeoutError) return { stillRunning: error.lastJob }
        throw error
    }
})
