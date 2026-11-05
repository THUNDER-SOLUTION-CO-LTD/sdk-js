// Gets one bank account linked to this branch.
// Usage: node examples/bank-accounts-get.ts <id>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const id = Number(arg(0, '<id>'))

await run(() => new Client().bankAccounts.get(id))
