// One page of every bank account of the service, linked to this branch or not.
// Usage: node examples/bank-accounts-list-all.ts [bank code]
import { Client } from '@thunder-solution/sdk'
import { run } from './util.ts'

const bankCode = process.argv[2]

await run(() => new Client().bankAccounts.listAll(bankCode ? { bankCode } : {}))
