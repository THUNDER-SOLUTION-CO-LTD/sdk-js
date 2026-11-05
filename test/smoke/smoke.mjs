import * as sdk from '@thunder-solution/sdk'
import checks from './checks.cjs'

await checks(sdk)
console.log(`import ok on ${process.version}`)
