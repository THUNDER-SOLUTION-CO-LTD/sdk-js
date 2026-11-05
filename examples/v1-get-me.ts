// v1: quota and credit of the application.
// Usage: node examples/v1-get-me.ts
import { Client } from '@thunder-solution/sdk'
import { run } from './util.ts'

await run(() => new Client().v1.getMe())
