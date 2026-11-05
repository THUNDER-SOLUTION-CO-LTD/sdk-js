// Unlinks an account from this branch. The account stays on the service.
// Usage: node examples/bank-accounts-unlink.ts <id>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const id = Number(arg(0, '<id>'))

await run(() => new Client().bankAccounts.unlink(id))
