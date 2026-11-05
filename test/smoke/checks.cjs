// Runs the installed package against a local mock of the API, on the runtime customers use.
// smoke.cjs and smoke.mjs hand over the SDK they loaded with require and import.
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { Readable } = require('node:stream')

const KEY = 'sk_test_smoke'
// Larger than one stream chunk, with every byte value, so line endings and encodings show up.
const JPEG = Buffer.alloc(200_000, Buffer.from(Array.from({ length: 256 }, (_, i) => i)))
JPEG.set([0xff, 0xd8, 0xff, 0xe0], 0)
const CHUNKS = [JPEG.subarray(0, 1), JPEG.subarray(1, 70_000), JPEG.subarray(70_000)]
const WEBHOOK_SECRET = 'whsec_สมมติ'
const SLIP = {
    amountInSlip: 100,
    rawSlip: {
        payload: 'P',
        transRef: 'T',
        date: '2026-10-29T10:00:00+07:00',
        countryCode: 'TH',
        amount: { amount: 100, local: { amount: 0, currency: '' } },
        sender: { account: { name: { th: 'ก' } } },
        receiver: { account: { name: { th: 'ข' } } },
    },
}
const BANKS = [
    {
        code: '004',
        nameTh: 'กสิกรไทย',
        nameEn: 'Kasikornbank',
        shortCode: 'KBANK',
        swiftCode: 'KASITHBK',
        extraVerify: null,
    },
]

function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', 'cf-ray': 'ray-1', ...headers })
    res.end(JSON.stringify(body))
}

function startMock() {
    const seen = []
    let bankCalls = 0
    const server = createServer((req, res) => {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
            const body = Buffer.concat(chunks)
            seen.push({ method: req.method, url: req.url, headers: req.headers, body })
            if (req.headers.authorization !== `Bearer ${KEY}`) {
                send(res, 401, {
                    success: false,
                    error: { code: 'INVALID_API_KEY', message: 'no' },
                })
            } else if (req.url === '/v2/banks') {
                // The first call fails, so the client has to retry over the real network.
                bankCalls += 1
                if (bankCalls === 1) {
                    send(
                        res,
                        503,
                        { success: false, error: { code: 'BUSY', message: 'busy' } },
                        { 'retry-after': '0' },
                    )
                } else send(res, 200, { success: true, data: BANKS })
            } else if (body.includes('hang')) {
                // Never answers: the timeout check aborts the request.
            } else if (body.includes('billed-503')) {
                send(
                    res,
                    503,
                    { success: false, error: { code: 'BUSY', message: 'busy' } },
                    { 'retry-after': '0' },
                )
            } else if (body.includes('missing')) {
                send(res, 404, {
                    success: false,
                    error: { code: 'SLIP_NOT_FOUND', message: 'not found' },
                })
            } else send(res, 200, { success: true, data: SLIP })
        })
    })
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }))
    })
}

/** The single file part of a multipart request: its headers and its exact bytes. */
function filePart({ headers, body }) {
    const [, boundary] = /^multipart\/form-data; boundary=(.+)$/.exec(headers['content-type'])
    const delimiter = Buffer.from(`--${boundary}`)
    const parts = []
    let at = body.indexOf(delimiter)
    while (at !== -1) {
        const start = at + delimiter.length
        const next = body.indexOf(delimiter, start)
        if (next === -1) break
        // Each part is CRLF, headers, CRLF CRLF, content, CRLF.
        const headerEnd = body.indexOf('\r\n\r\n', start)
        parts.push({
            headers: body.subarray(start + 2, headerEnd).toString(),
            bytes: body.subarray(headerEnd + 4, next - 2),
        })
        at = next
    }
    const files = parts.filter((part) => part.headers.includes('filename='))
    assert.equal(files.length, 1)
    return files[0]
}

function uploadInputs(path) {
    // A view into a larger buffer: reading the whole buffer instead of the view sends wrong bytes.
    const padded = new Uint8Array(JPEG.length + 20).fill(0x55)
    padded.set(JPEG, 10)
    return {
        path,
        Buffer: Buffer.from(JPEG),
        Uint8Array: padded.subarray(10, 10 + JPEG.length),
        Blob: new Blob([JPEG], { type: 'image/jpeg' }),
        'Node stream': Readable.from(CHUNKS, { objectMode: false }),
        'web stream': new ReadableStream({
            start(controller) {
                for (const chunk of CHUNKS) controller.enqueue(new Uint8Array(chunk))
                controller.close()
            },
        }),
    }
}

function checkWebhooks(sdk) {
    // The expected signature comes from node:crypto, not from the SDK's own HMAC.
    const sign = (body, secret) =>
        `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    const event = JSON.stringify({ jobId: 'j1', status: 'success', timestamp: 't', note: 'สลิป' })
    const cases = [
        [event, 'secret'],
        [event, WEBHOOK_SECRET],
        [event, 'k'.repeat(64)],
        [event, 'k'.repeat(65)],
        [`{"jobId":"j2","status":"failed","timestamp":"t","pad":"${'x'.repeat(5000)}"}`, 'secret'],
    ]
    for (const [body, secret] of cases) {
        const good = sign(body, secret)
        assert.equal(sdk.verifyWebhookSignature(body, good, secret), true)
        assert.equal(sdk.verifyWebhookSignature(Buffer.from(body), good, secret), true)
        assert.equal(sdk.verifyWebhookSignature(`${body} `, good, secret), false, 'changed body')
        assert.equal(sdk.verifyWebhookSignature(body, good, `${secret}x`), false, 'wrong secret')
        assert.equal(sdk.verifyWebhookSignature(body, sign(`${body} `, secret), secret), false)
        const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0')
        assert.equal(sdk.verifyWebhookSignature(body, flipped, secret), false, 'changed signature')
        assert.equal(sdk.verifyWebhookSignature(body, good.slice(7), secret), false, 'no prefix')
        assert.equal(sdk.verifyWebhookSignature(body, undefined, secret), false, 'no header')
    }
    const signature = sign(event, 'secret')
    assert.equal(sdk.constructWebhookEvent(event, signature, 'secret').jobId, 'j1')
    assert.throws(
        () => sdk.constructWebhookEvent(event, sign(event, 'other'), 'secret'),
        sdk.WebhookSignatureError,
    )
}

function expectRuntime(userAgent) {
    const { EXPECT_RUNTIME: runtime, EXPECT_MAJOR: major } = process.env
    if (runtime === 'node') {
        assert.equal(process.versions.bun, undefined, 'this run must be on Node.js, not Bun')
        if (major) assert.equal(process.versions.node.split('.')[0], major)
        assert.ok(userAgent.includes(`node/${process.versions.node}`), userAgent)
    } else {
        assert.equal(runtime, 'bun')
        assert.ok(process.versions.bun, 'this run must be on Bun')
        assert.ok(userAgent.includes(`bun/${process.versions.bun}`), userAgent)
    }
}

module.exports = async function checks(sdk) {
    assert.equal(Object.keys(sdk).filter((name) => name !== 'default').length, 39)
    const { server, seen, port } = await startMock()
    const work = mkdtempSync(join(tmpdir(), 'thunder-smoke-'))
    const client = new sdk.Thunder({
        apiKey: KEY,
        v1BaseUrl: `http://127.0.0.1:${port}/v1`,
        v2BaseUrl: `http://127.0.0.1:${port}/v2`,
    })
    try {
        expectRuntime(client.userAgent)

        // JSON request and decoded result.
        const byPayload = await client.verify.bankByPayload('payload-1', { matchAmount: 100 })
        assert.equal(byPayload.amountInSlip, 100)
        assert.equal(byPayload.rawSlip.transRef, 'T')
        const sent = seen.at(-1)
        assert.equal(sent.method, 'POST')
        assert.equal(sent.url, '/v2/verify/bank')
        assert.equal(sent.headers['user-agent'], client.userAgent)
        assert.deepEqual(JSON.parse(sent.body), { payload: 'payload-1', matchAmount: 100 })

        // Every upload kind reaches the API with exactly the source bytes.
        const path = join(work, 'slip.jpg')
        writeFileSync(path, JPEG)
        const inputs = uploadInputs(path)
        assert.equal(Object.keys(inputs).length, 6)
        for (const [kind, image] of Object.entries(inputs)) {
            const result = await client.verify.bankByImage(image)
            assert.equal(result.amountInSlip, 100, kind)
            const part = filePart(seen.at(-1))
            assert.match(part.headers, /name="image"/, kind)
            assert.match(part.headers, /content-type: image\/jpeg/i, kind)
            assert.ok(part.bytes.equals(JPEG), `${kind}: the API received different bytes`)
        }

        // API errors map to their classes.
        await assert.rejects(client.verify.bankByPayload('missing'), (error) => {
            assert.ok(error instanceof sdk.SlipNotFoundError)
            assert.ok(error instanceof sdk.ApiError)
            assert.equal(error.name, 'SlipNotFoundError')
            assert.equal(error.status, 404)
            assert.equal(error.code, 'SLIP_NOT_FOUND')
            assert.equal(error.requestId, 'ray-1')
            return true
        })
        const stranger = new sdk.Thunder({ apiKey: 'wrong', v2BaseUrl: client.v2BaseUrl })
        await assert.rejects(stranger.verify.bankByPayload('x'), sdk.AuthenticationError)

        // A safe call retries a 503 and then succeeds.
        const before = seen.length
        const banks = await client.banks.list()
        assert.equal(banks.items[0].shortCode, 'KBANK')
        assert.equal(seen.length - before, 2)

        // A billed call is never sent twice after a 503: a second send can charge twice.
        for (const billed of [
            () => client.verify.bankByPayload('billed-503'),
            () => client.verify.bankByPayload('payload-1', { remark: 'billed-503' }),
            () => client.verify.bankByImage(JPEG, { remark: 'billed-503' }),
        ]) {
            const sentBefore = seen.length
            await assert.rejects(billed(), sdk.ServiceUnavailableError)
            assert.equal(seen.length - sentBefore, 1, 'billed POST sent more than once')
        }

        // Network failures.
        const slow = new sdk.Thunder({
            apiKey: KEY,
            v2BaseUrl: client.v2BaseUrl,
            timeout: 100,
            maxRetries: 0,
        })
        await assert.rejects(slow.verify.bankByPayload('hang'), sdk.RequestTimeoutError)
        const closed = createServer()
        const closedPort = await new Promise((resolve) => {
            closed.listen(0, '127.0.0.1', () => {
                const { port: free } = closed.address()
                closed.close(() => resolve(free))
            })
        })
        const offline = new sdk.Thunder({
            apiKey: KEY,
            v2BaseUrl: `http://127.0.0.1:${closedPort}/v2`,
            maxRetries: 0,
        })
        await assert.rejects(offline.banks.list(), sdk.NetworkError)

        // Local input errors and webhook signatures need no network.
        await assert.rejects(client.verify.bankByImage(join(work, 'nope.jpg')), sdk.InputError)
        checkWebhooks(sdk)
    } finally {
        server.closeAllConnections?.()
        server.close()
        rmSync(work, { recursive: true, force: true })
    }
}
