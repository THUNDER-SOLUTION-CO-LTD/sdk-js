// v1: verifies a bank slip image sent as base64.
// Usage: node examples/v1-verify-bank-base64.ts <image file>
import { readFile } from 'node:fs/promises'
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const base64 = (await readFile(arg(0, '<image file>'))).toString('base64')

await run(() => new Client().v1.verifyBankByBase64(base64))
