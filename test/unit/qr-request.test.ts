import { describe, expect, test } from 'bun:test'
import type { QrRequest } from '../../src/index.ts'
import { bodyOf, mockClient } from './helpers.ts'

const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47))
const qrResponse = () =>
    new Response(
        JSON.stringify({ status: 200, data: { image: png, mime: 'image/png', payload: '000201' } }),
    )

describe('generateQr request shapes (API rules of 2026-10-30)', () => {
    test('sends Biller ID without ref1, shop ids and merchantName exactly as given', async () => {
        const { client, sent } = mockClient(qrResponse)
        const requests: QrRequest[] = [
            { type: 'PROMPTPAY', billerId: '010555123456701', amount: 125.5 },
            { type: 'BILL_PAYMENT', billerId: '010555123456701' },
            { type: 'KSHOP', ref1: 'KB000001234567', amount: 250 },
            { type: 'KSHOP', ref1: 'kps004kb000001234567' },
            { type: 'MAE_MANEE', ref1: '014000123456789' },
            { type: 'TUNGNGERN', ref1: 'ORDER12345', merchantName: 'MY STORE', amount: 750 },
        ]
        for (const request of requests) await client.v1.generateQr(request)
        expect(sent.map(bodyOf)).toEqual(requests)
        expect(sent.every((s) => s.url.pathname.endsWith('/qr/generate'))).toBe(true)
    })

    test('TUNGNGERN without merchantName does not type check', () => {
        // @ts-expect-error merchantName is required for TUNGNGERN
        const request: QrRequest = { type: 'TUNGNGERN', ref1: 'ORDER12345' }
        expect(request.type).toBe('TUNGNGERN')
    })
})
