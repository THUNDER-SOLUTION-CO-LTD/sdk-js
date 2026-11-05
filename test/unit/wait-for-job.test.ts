import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import * as sdk from '../../src/index.ts'
import { job, KEY, mockClient, ok } from './helpers.ts'

// waitForJob keeps one deadline for the whole wait. The mock API answers per
// job id: `slow` says done after 300 ms, `stall` never answers, `busy` answers 503 with
// Retry-After 1, `poll` says retrying once and then stalls.
let server: Server
let base = ''
const closed: string[] = []
let polls = 0

beforeAll(async () => {
    server = createServer((req, res) => {
        const id = req.url?.split('/').pop() ?? ''
        res.on('close', () => {
            if (!res.writableEnded) closed.push(id)
        })
        const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
            res.writeHead(status, { 'content-type': 'application/json', ...headers })
            res.end(JSON.stringify(body))
        }
        if (id === 'slow') {
            const timer = setTimeout(() => send(200, { success: true, data: job('done') }), 300)
            res.on('close', () => clearTimeout(timer))
        } else if (id === 'busy') {
            send(
                503,
                { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'busy' } },
                { 'retry-after': '1' },
            )
        } else if (id === 'poll' && polls++ === 0) {
            send(200, { success: true, data: job('retrying') })
        }
        // `stall` and later `poll` requests never answer.
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    base = `http://127.0.0.1:${port}`
})

afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
})

const client = (options: sdk.ClientOptions = {}) =>
    new sdk.Client({ apiKey: KEY, v2BaseUrl: `${base}/v2`, timeout: 30_000, ...options })

async function timed<T>(run: () => Promise<T>) {
    const start = performance.now()
    const result = await run().catch((e) => e)
    return { result, elapsed: performance.now() - start }
}

describe('waitForJob deadline', () => {
    test('a terminal answer that comes after the deadline is not returned', async () => {
        const { result, elapsed } = await timed(() =>
            client().jobs.waitForJob('slow', { timeout: 80 }),
        )
        expect(result).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect((result as sdk.JobWaitTimeoutError).lastJob).toBeNull()
        expect(elapsed).toBeGreaterThanOrEqual(75)
        expect(elapsed).toBeLessThan(250)
    })

    test('a stalled request is cancelled at the deadline', async () => {
        const { result, elapsed } = await timed(() =>
            client().jobs.waitForJob('stall', { timeout: 80 }),
        )
        expect(result).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect(elapsed).toBeLessThan(250)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(closed).toContain('stall')
    })

    test('retries inside a poll stop at the deadline', async () => {
        const { result, elapsed } = await timed(() =>
            client({ maxRetries: 3 }).jobs.waitForJob('busy', { timeout: 120 }),
        )
        expect(result).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect(elapsed).toBeLessThan(400)
    })

    test('lastJob is the last job received before the deadline', async () => {
        const fast = (ms: number, signal?: AbortSignal) =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, Math.min(ms, 10))
                signal?.addEventListener('abort', () => resolve())
            })
        const { result } = await timed(() =>
            client({ sleep: fast }).jobs.waitForJob('poll', { timeout: 150 }),
        )
        expect(result).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect((result as sdk.JobWaitTimeoutError).lastJob?.status).toBe('retrying')
    })

    test('a response that ignores cancellation and comes late is not returned', async () => {
        const late = mockClient(
            () =>
                new Promise<Response>((resolve) => setTimeout(() => resolve(ok(job('done'))), 200)),
        )
        const { result, elapsed } = await timed(() =>
            late.client.jobs.waitForJob('job-1', { timeout: 60 }),
        )
        expect(result).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect(elapsed).toBeLessThan(180)
    })

    test('a sleep that ignores the signal does not hold the call', async () => {
        const deaf = mockClient(() => ok(job('queued')), {
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        })
        const { result, elapsed } = await timed(() =>
            deaf.client.jobs.waitForJob('job-1', { timeout: 60, interval: 5000 }),
        )
        expect(result).toBeInstanceOf(sdk.JobWaitTimeoutError)
        expect((result as sdk.JobWaitTimeoutError).lastJob?.status).toBe('queued')
        expect(elapsed).toBeLessThan(180)
    })

    test('caller cancellation rejects with the caller reason', async () => {
        const controller = new AbortController()
        const reason = new Error('stopped by caller')
        setTimeout(() => controller.abort(reason), 40)
        const { result, elapsed } = await timed(() =>
            client().jobs.waitForJob('stall', { timeout: 5000, signal: controller.signal }),
        )
        expect(result).toBe(reason)
        expect(elapsed).toBeLessThan(500)
        const already = await client()
            .jobs.waitForJob('stall', { signal: controller.signal })
            .catch((e) => e)
        expect(already).toBe(reason)
    })

    test('rejects a bad timeout before sending', async () => {
        const { client, sent } = mockClient(() => ok(job('done')))
        for (const timeout of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            const error = await client.jobs.waitForJob('job-1', { timeout }).catch((e) => e)
            expect(error).toBeInstanceOf(sdk.InputError)
        }
        expect(sent.length).toBe(0)
    })
})
