const sdk = require('@thunder-solution/sdk')
const checks = require('./checks.cjs')

checks(sdk).then(() => console.log(`require ok on ${process.version}`))
