// Links an existing account of the service to this branch. Linking twice is fine.
// Usage: node examples/bank-accounts-link.ts <id>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const id = Number(arg(0, '<id>'))

await run(() => new Client().bankAccounts.link(id))
