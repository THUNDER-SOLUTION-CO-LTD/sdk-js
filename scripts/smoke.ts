// Packs the SDK, installs the tarball in an empty project the way a customer does, then runs
// test/smoke with require and import. Usage: bun scripts/smoke.ts <node|bun> [node major]
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [runtime, major] = process.argv.slice(2)
if (runtime !== 'node' && runtime !== 'bun') throw new Error('usage: smoke.ts <node|bun> [major]')

const root = join(import.meta.dir, '..')
const work = mkdtempSync(join(tmpdir(), 'thunder-sdk-smoke-'))

function run(cmd: string[], cwd: string) {
    const env = { ...process.env, EXPECT_RUNTIME: runtime, EXPECT_MAJOR: major ?? '' }
    const { exitCode } = Bun.spawnSync({ cmd, cwd, env, stdout: 'inherit', stderr: 'inherit' })
    if (exitCode !== 0) throw new Error(`${cmd.join(' ')} exited with ${exitCode}`)
}

try {
    const tarball = join(work, 'sdk.tgz')
    run(['bun', 'pm', 'pack', `--filename=${tarball}`, '--quiet'], root)
    const app = join(work, 'app')
    cpSync(join(root, 'test', 'smoke'), app, { recursive: true })
    writeFileSync(join(app, 'package.json'), '{ "name": "smoke-app", "private": true }\n')
    run(
        runtime === 'node'
            ? ['npm', 'install', '--no-audit', '--no-fund', '--silent', tarball]
            : ['bun', 'add', '--silent', tarball],
        app,
    )
    run([runtime, 'smoke.cjs'], app)
    run([runtime, 'smoke.mjs'], app)
} finally {
    rmSync(work, { recursive: true, force: true })
}
