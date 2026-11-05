// Lists the bank codes you can register accounts with.
// Usage: node examples/banks-list.ts [bank code]
import { Client } from '@thunder-solution/sdk'
import { run } from './util.ts'

const code = process.argv[2]

await run(async () => {
    const banks = await new Client().banks.list()
    if (code) return banks.find(code) ?? `no bank with code ${code}`
    for (const bank of banks) console.log(bank.code, bank.shortCode, bank.nameEn)
    return undefined
})
