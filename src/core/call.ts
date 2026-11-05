import { type ModelName, parseModel } from '../models.js'
import { InputError } from './errors.js'
import type { PreparedFile } from './files.js'
import type { RequestOptions, RequestSpec, Transport } from './http.js'
import { attachMeta, type WithMeta } from './meta.js'

type Models = {
    [N in ModelName]: ReturnType<typeof parseModel<N>>
}

/** Sends `spec` and decodes `data` into the named model, with `meta` attached. */
export async function call<N extends ModelName>(
    transport: Transport,
    model: N,
    spec: RequestSpec,
): Promise<WithMeta<Models[N]>> {
    const { data, meta } = await transport.request(spec)
    return attachMeta(parseModel(model, data) as Models[N] & object, meta)
}

/** Copies the per-call request options out of a merged options object. */
export function requestOptions(options: RequestOptions | undefined): RequestOptions {
    if (!options) return {}
    const out: RequestOptions = {}
    if (options.signal !== undefined) out.signal = options.signal
    if (options.timeout !== undefined) out.timeout = options.timeout
    if (options.maxRetries !== undefined) out.maxRetries = options.maxRetries
    return out
}

/** Copies the listed keys that are set (not undefined). Explicit nulls are kept. */
export function defined<T extends object, K extends keyof T>(
    source: T | undefined,
    keys: readonly K[],
): Partial<Pick<T, K>> {
    const out: Partial<Pick<T, K>> = {}
    if (!source) return out
    for (const key of keys) {
        if (source[key] !== undefined) out[key] = source[key]
    }
    return out
}

/** Multipart form with the image part and string fields (`true`/`false`, plain numbers). */
export function imageForm(
    field: string,
    file: PreparedFile,
    fields: Record<string, string | number | boolean>,
): FormData {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
    form.append(field, new Blob([file.bytes], { type: file.contentType }), file.filename)
    return form
}

export function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new InputError('INVALID_ARGUMENT', `${name} must be a non-empty string`)
    }
    return value
}

export function requireId(value: unknown, name = 'id'): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new InputError('INVALID_ARGUMENT', `${name} must be a positive integer`)
    }
    return value
}
