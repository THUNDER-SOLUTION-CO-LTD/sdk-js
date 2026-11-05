// One page of the bank accounts linked to this branch.
// Usage: node examples/bank-accounts-list.ts [page] [limit]
import { Client } from '@thunder-solution/sdk'
import { run } from './util.ts'

const page = Number(process.argv[2] ?? 1)
const limit = Number(process.argv[3] ?? 20)

await run(() => new Client().bankAccounts.list({ page, limit }))
