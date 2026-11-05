import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { errorCodes, statusFallback } from '../../src/core/error-codes.ts'
import * as sdk from '../../src/index.ts'
import { VERSION } from '../../src/version.ts'
import { mockClient, v2error } from './helpers.ts'

interface Catalogue {
    classes: Record<string, { parent: string }>
    statusFallback: Record<string, string>
    codes: Record<'v1' | 'v2', Record<string, { class: string }>>
}

const catalogue: Catalogue = JSON.parse(
    readFileSync(new URL('../fixtures/errors.json', import.meta.url), 'utf8'),
)
const classOf = (codes: Record<string, { class: string }>) =>
    Object.fromEntries(Object.entries(codes).map(([code, entry]) => [code, entry.class]))

test('every API error code maps to the class in the error catalogue', () => {
    expect(errorCodes.v1 as Record<string, string>).toEqual(classOf(catalogue.codes.v1))
    expect(errorCodes.v2 as Record<string, string>).toEqual(classOf(catalogue.codes.v2))
})

test('unknown codes fall back to the class for their HTTP status', () => {
    expect(statusFallback as Record<number, string>).toEqual(
        Object.fromEntries(
            Object.entries(catalogue.statusFallback).map(([status, cls]) => [Number(status), cls]),
        ),
    )
})

test('other 5xx statuses without a known code are ServerError, 503 is ServiceUnavailableError', async () => {
    for (const status of [500, 501, 502, 504, 507, 599]) {
        const { client } = mockClient(() => v2error(status, 'UNLISTED'), { maxRetries: 0 })
        const error = await client.getInfo().catch((e: unknown) => e)
        expect((error as object).constructor, String(status)).toBe(sdk.ServerError)
    }
    const unavailable = mockClient(() => v2error(503, 'UNLISTED'), { maxRetries: 0 })
    const error503 = await unavailable.client.getInfo().catch((e: unknown) => e)
    expect((error503 as object).constructor).toBe(sdk.ServiceUnavailableError)
    const teapot = mockClient(() => v2error(418, 'UNLISTED'), { maxRetries: 0 })
    const error418 = await teapot.client.getInfo().catch((e: unknown) => e)
    expect((error418 as object).constructor).toBe(sdk.ApiError)
})

test('error classes have the parents listed in the catalogue', () => {
    for (const [name, { parent }] of Object.entries(catalogue.classes)) {
        const cls = (sdk as unknown as Record<string, abstract new (...args: never) => unknown>)[
            name
        ]
        expect(cls, name).toBeDefined()
        const expected = parent === 'root' ? sdk.ThunderError : (sdk as never)[parent]
        expect(Object.getPrototypeOf(cls), name).toBe(expected)
    }
})

test('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(VERSION).toBe(pkg.version)
})

test('an input error prints its code', () => {
    const error = new sdk.InputError('INVALID_ARGUMENT', 'no API key')
    expect(String(error)).toBe('InputError: [INVALID_ARGUMENT] no API key')
})
