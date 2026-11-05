// Walks every page of the accounts linked to this branch.
// Usage: node examples/bank-accounts-iterate.ts
import { Client } from '@thunder-solution/sdk'
import { run } from './util.ts'

await run(async () => {
    let count = 0
    for await (const account of new Client().bankAccounts.iterate()) {
        console.log(account.id, account.bankCode, account.bankNumber, account.nameEn)
        count++
    }
    return { count }
})
