// Changes the English name of a bank account. Pass "clear" as the second argument to clear
// its extraVerify instead.
// Usage: node examples/bank-accounts-update.ts <id> <new English name | clear>
import { Client } from '@thunder-solution/sdk'
import { arg, run } from './util.ts'

const id = Number(arg(0, '<id> <new English name | clear>'))
const value = arg(1, '<id> <new English name | clear>')

await run(() =>
    new Client().bankAccounts.update(
        id,
        value === 'clear' ? { extraVerify: null } : { nameEn: value },
    ),
)
