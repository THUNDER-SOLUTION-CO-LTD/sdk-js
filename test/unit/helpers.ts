import { Client, type ClientOptions } from '../../src/index.ts'

export const KEY = 'sk_test_unit_5f2c9a7e1b'
export const V1 = 'https://api.test/v1'
export const V2 = 'https://api.test/v2'

export interface Sent {
    url: URL
    init: RequestInit
    headers: Headers
}

export type Responder = (sent: Sent, index: number) => Response | Promise<Response>

export function json(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cf-ray': 'ray-1-BKK', ...headers },
    })
}

export const ok = (data: unknown, headers?: Record<string, string>) =>
    json(200, { success: true, data }, headers)

export const v2error = (
    status: number,
    code: string,
    message = code,
    headers?: Record<string, string>,
) => json(status, { success: false, error: { code, message } }, headers)

/** A client whose fetch records every request and answers with `respond`. */
export function mockClient(respond: Responder, options: ClientOptions = {}) {
    const sent: Sent[] = []
    const delays: number[] = []
    const client = new Client({
        apiKey: KEY,
        v1BaseUrl: V1,
        v2BaseUrl: V2,
        sleep: async (ms) => {
            delays.push(ms)
        },
        ...options,
        fetch: async (input, init = {}) => {
            const entry = { url: new URL(String(input)), init, headers: new Headers(init.headers) }
            sent.push(entry)
            return respond(entry, sent.length - 1)
        },
    })
    return { client, sent, delays }
}

export function bodyOf(sent: Sent): unknown {
    return typeof sent.init.body === 'string' ? JSON.parse(sent.init.body) : sent.init.body
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
export const GIF = new TextEncoder().encode('GIF89a....')
export const WEBP = new TextEncoder().encode('RIFF\x10\x00\x00\x00WEBPVP8 ')

export const slipResult = {
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

export function job(status: string, extra: Record<string, unknown> = {}) {
    return {
        jobId: 'job-1',
        status,
        attempts: 0,
        createdAt: '2026-10-29T03:00:00.000Z',
        updatedAt: '2026-10-29T03:00:01.000Z',
        ...extra,
    }
}
