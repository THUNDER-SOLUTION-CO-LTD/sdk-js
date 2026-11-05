// A webhook endpoint: checks the signature in WEBHOOK_SIGNATURE_HEADER against the secret in
// THUNDER_WEBHOOK_SECRET and answers within 5 seconds. Stop it with Ctrl+C.
// Usage: node examples/webhook-receiver.ts [port]
import { createServer } from 'node:http'
import {
    constructWebhookEvent,
    InputError,
    WEBHOOK_SIGNATURE_HEADER,
    WebhookSignatureError,
} from '@thunder-solution/sdk'

const port = Number(process.argv[2] ?? 8787)
if (!process.env.THUNDER_WEBHOOK_SECRET) throw new Error('set THUNDER_WEBHOOK_SECRET')

const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
        response.writeHead(405).end('method not allowed')
        return
    }
    try {
        // Read the body as raw bytes: the signature covers the exact bytes that were sent.
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk as Buffer)
        const rawBody = Buffer.concat(chunks)
        const event = constructWebhookEvent(
            rawBody,
            request.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()] as string | undefined,
        )
        // De-duplicate on event.jobId: the same event can be delivered more than once.
        console.log(event.jobId, event.status, event.data?.rawSlip.transRef ?? '')
        response.writeHead(200).end('ok')
    } catch (error) {
        if (error instanceof WebhookSignatureError || error instanceof InputError) {
            // A missing or wrong signature, or a signed body that is not a webhook event.
            response.writeHead(400).end('invalid webhook')
            return
        }
        // Anything else is a fault on this server: Thunder sends the event again later.
        console.error('webhook failed', error)
        response.writeHead(500).end('error')
    }
})

server.listen(port, () => {
    console.log(`listening on http://localhost:${port} for ${WEBHOOK_SIGNATURE_HEADER}`)
})
