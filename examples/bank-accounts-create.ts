// Registers a receiving bank account and links it to this branch.
// Usage: node examples/bank-accounts-create.ts <bank code> <account number> <Thai name> <English name> [NATURAL|JURISTIC]
import { Client, ConflictError } from '@thunder-solution/sdk'
import { accountTypeArg, arg, run } from './util.ts'

const usage = '<bank code> <account number> <Thai name> <English name> [NATURAL|JURISTIC]'
const params = {
    bankCode: arg(0, usage),
    bankNumber: arg(1, usage),
    nameTh: arg(2, usage),
    nameEn: arg(3, usage),
    type: accountTypeArg(4, usage) ?? 'NATURAL',
}

await run(async () => {
    try {
        return await new Client().bankAccounts.create(params)
    } catch (error) {
        if (error instanceof ConflictError) return `already registered: ${error.message}`
        throw error
    }
})
