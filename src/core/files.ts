import { InputError } from './errors.js'
import { loadFs } from './runtime.js'

/** Largest image the API accepts, in bytes (4 MB). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * An image to upload: a file path (Node, Bun, Deno), a `file:` URL, bytes (`Uint8Array`,
 * `Buffer`, `ArrayBuffer`), a `Blob` or `File`, a web `ReadableStream`, or any async iterable
 * of byte chunks such as a Node readable stream.
 */
export type FileInput =
    | string
    | URL
    | Uint8Array
    | ArrayBuffer
    | Blob
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array | string>

export interface PreparedFile {
    bytes: Uint8Array<ArrayBuffer>
    contentType: string
    filename: string
}

const types: ReadonlyArray<{ type: string; ext: string; test: (b: Uint8Array) => boolean }> = [
    {
        type: 'image/jpeg',
        ext: 'jpg',
        test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    {
        type: 'image/png',
        ext: 'png',
        test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    },
    {
        type: 'image/gif',
        ext: 'gif',
        test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
    },
    {
        type: 'image/webp',
        ext: 'webp',
        test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' && b.length >= 12,
    },
]

function ascii(bytes: Uint8Array, start: number, end: number): string {
    return String.fromCharCode(...bytes.subarray(start, end))
}

/** Image type from the first bytes, or null when it is not JPEG, PNG, GIF or WebP. */
export function sniffImageType(bytes: Uint8Array): { type: string; ext: string } | null {
    const hit = types.find((t) => t.test(bytes))
    return hit ? { type: hit.type, ext: hit.ext } : null
}

function tooLarge(size: number): InputError {
    return new InputError(
        'FILE_TOO_LARGE',
        `file is ${size} bytes; the API accepts at most ${MAX_IMAGE_BYTES} bytes`,
    )
}

async function collect(
    chunks: AsyncIterable<Uint8Array | string>,
    maxBytes: number,
): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    let size = 0
    const encoder = new TextEncoder()
    for await (const chunk of chunks) {
        const part = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
        size += part.byteLength
        if (size > maxBytes) throw tooLarge(size)
        parts.push(part)
    }
    const out = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.byteLength
    }
    return out
}

async function* readStream(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
    const reader = stream.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) return
            yield value
        }
    } finally {
        reader.releaseLock()
    }
}

async function readPath(path: string | URL, maxBytes: number): Promise<Uint8Array> {
    const fs = await loadFs()
    if (!fs) {
        throw new InputError(
            'FILE_NOT_READABLE',
            'file paths need a runtime with a file system; pass bytes, a Blob or a stream',
        )
    }
    let info: { size: number; isFile(): boolean }
    try {
        info = await fs.stat(path)
    } catch (cause) {
        throw new InputError('FILE_NOT_READABLE', `cannot read ${String(path)}`, { cause })
    }
    if (!info.isFile()) throw new InputError('FILE_NOT_READABLE', `not a file: ${String(path)}`)
    if (info.size > maxBytes) throw tooLarge(info.size)
    try {
        return await fs.readFile(path)
    } catch (cause) {
        throw new InputError('FILE_NOT_READABLE', `cannot read ${String(path)}`, { cause })
    }
}

async function readBytes(input: FileInput, maxBytes: number): Promise<Uint8Array> {
    if (typeof input === 'string' || input instanceof URL) return readPath(input, maxBytes)
    if (input instanceof Uint8Array) return input
    if (input instanceof ArrayBuffer) return new Uint8Array(input)
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
        if (input.size > maxBytes) throw tooLarge(input.size)
        return new Uint8Array(await input.arrayBuffer())
    }
    if (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream) {
        return collect(readStream(input), maxBytes)
    }
    if (input && typeof (input as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
        return collect(input as AsyncIterable<Uint8Array | string>, maxBytes)
    }
    throw new InputError(
        'INVALID_ARGUMENT',
        'file must be a path, URL, Uint8Array, ArrayBuffer, Blob or stream',
    )
}

/** Reads an image input, checks its size and type, and names it `slip.<ext>`. */
export async function prepareFile(
    input: FileInput,
    maxBytes: number = MAX_IMAGE_BYTES,
): Promise<PreparedFile> {
    const raw = await readBytes(input, maxBytes)
    if (raw.byteLength === 0) throw new InputError('EMPTY_FILE', 'file is empty')
    if (raw.byteLength > maxBytes) throw tooLarge(raw.byteLength)
    const kind = sniffImageType(raw)
    if (!kind) {
        throw new InputError('UNSUPPORTED_FILE_TYPE', 'file is not a JPEG, PNG, GIF or WebP image')
    }
    return { bytes: new Uint8Array(raw), contentType: kind.type, filename: `slip.${kind.ext}` }
}
