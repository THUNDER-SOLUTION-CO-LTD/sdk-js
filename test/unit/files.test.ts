import { describe, expect, test } from 'bun:test'
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_IMAGE_BYTES, prepareFile, sniffImageType } from '../../src/core/files.ts'
import { InputError } from '../../src/index.ts'
import { GIF, JPEG, mockClient, ok, PNG, slipResult, WEBP } from './helpers.ts'

function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(c)
            controller.close()
        },
    })
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise
        return undefined
    } catch (e) {
        expect(e).toBeInstanceOf(InputError)
        return (e as InputError).code
    }
}

describe('file inputs', () => {
    test('sniffs JPEG, PNG, GIF and WebP', () => {
        expect(sniffImageType(JPEG)?.type).toBe('image/jpeg')
        expect(sniffImageType(PNG)?.type).toBe('image/png')
        expect(sniffImageType(GIF)?.type).toBe('image/gif')
        expect(sniffImageType(WEBP)?.type).toBe('image/webp')
        expect(sniffImageType(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    })

    test('accepts bytes, ArrayBuffer, Buffer, Blob, File, streams, paths and file URLs', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sdk-js-files-'))
        try {
            const path = join(dir, 'photo.jpeg')
            writeFileSync(path, JPEG)
            const inputs = [
                JPEG,
                JPEG.buffer.slice(0),
                Buffer.from(JPEG),
                new Blob([JPEG]),
                new File([JPEG], 'x.bin'),
                stream([JPEG.subarray(0, 2), JPEG.subarray(2)]),
                createReadStream(path),
                path,
                pathToFileURL(path),
            ]
            for (const input of inputs) {
                const file = await prepareFile(input as never)
                expect([...file.bytes]).toEqual([...JPEG])
                expect(file.contentType).toBe('image/jpeg')
                expect(file.filename).toBe('slip.jpg')
            }
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('rejects empty, unknown, unreadable and too large files before sending', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sdk-js-files-'))
        try {
            const big = join(dir, 'big.png')
            const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1)
            bytes.set(PNG)
            writeFileSync(big, bytes)
            expect(await code(prepareFile(new Uint8Array()))).toBe('EMPTY_FILE')
            expect(await code(prepareFile(new TextEncoder().encode('%PDF-1.7')))).toBe(
                'UNSUPPORTED_FILE_TYPE',
            )
            expect(await code(prepareFile(join(dir, 'missing.png')))).toBe('FILE_NOT_READABLE')
            expect(await code(prepareFile(dir))).toBe('FILE_NOT_READABLE')
            expect(await code(prepareFile(big))).toBe('FILE_TOO_LARGE')
            expect(await code(prepareFile(bytes))).toBe('FILE_TOO_LARGE')
            expect(await code(prepareFile(new Blob([bytes])))).toBe('FILE_TOO_LARGE')
            expect(
                await code(prepareFile(stream([bytes.subarray(0, 10), bytes.subarray(10)]))),
            ).toBe('FILE_TOO_LARGE')
            expect(await code(prepareFile(42 as never))).toBe('INVALID_ARGUMENT')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
        const { client, sent } = mockClient(() => ok(slipResult))
        await expect(client.verify.bankByImage(new Uint8Array())).rejects.toThrow(InputError)
        expect(sent.length).toBe(0)
    })

    test('a file at exactly the limit is accepted', async () => {
        const bytes = new Uint8Array(MAX_IMAGE_BYTES)
        bytes.set(PNG)
        expect((await prepareFile(bytes)).bytes.byteLength).toBe(MAX_IMAGE_BYTES)
    })

    test('v2 image upload: field image, slip.<ext>, options as strings', async () => {
        const { client, sent } = mockClient(() => ok(slipResult))
        await client.verify.bankByImage(WEBP, {
            matchAmount: 500,
            checkDuplicate: true,
            matchAccount: false,
        })
        const form = sent[0]?.init.body as FormData
        const file = form.get('image') as File
        expect([file.name, file.type, file.size]).toEqual([
            'slip.webp',
            'image/webp',
            WEBP.byteLength,
        ])
        expect(form.get('matchAmount')).toBe('500')
        expect(form.get('checkDuplicate')).toBe('true')
        expect(form.get('matchAccount')).toBe('false')
        expect(form.has('remark')).toBe(false)
    })
})
