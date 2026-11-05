// Walks every page of all accounts of the service, optionally of one type.
// Usage: node examples/bank-accounts-iterate-all.ts [NATURAL|JURISTIC]
import { Client } from '@thunder-solution/sdk'
import { accountTypeArg, run } from './util.ts'

const type = accountTypeArg(0, '[NATURAL|JURISTIC]')

await run(async () => {
    let count = 0
    for await (const account of new Client().bankAccounts.iterateAll(type ? { type } : {})) {
        console.log(account.id, account.type, account.bankNumber, account.nameEn)
        count++
    }
    return { count }
})
