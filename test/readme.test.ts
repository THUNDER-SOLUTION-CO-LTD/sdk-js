// Type-checks every TypeScript code block in README.md and README.th.md exactly as written, so
// the samples customers copy keep compiling against the current API.

import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('every README code block compiles', () => {
    const work = mkdtempSync(join(root, 'node_modules', '.readme-check-'))
    try {
        const files: string[] = []
        for (const readme of ['README.md', 'README.th.md']) {
            const text = readFileSync(join(root, readme), 'utf8')
            const blocks = [...text.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((match) => match[1])
            expect(blocks.length, `${readme} has ts code blocks`).toBeGreaterThan(0)
            blocks.forEach((code, index) => {
                const file = `${readme.replace(/\W/g, '-')}-${String(index + 1).padStart(2, '0')}.ts`
                writeFileSync(join(work, file), code ?? '')
                files.push(file)
            })
        }
        // The settings of a strict application project, with @thunder-solution/sdk resolved to this source.
        const config = {
            compilerOptions: {
                target: 'ES2022',
                module: 'esnext',
                moduleResolution: 'bundler',
                lib: ['ES2022', 'DOM', 'DOM.Iterable'],
                types: ['node'],
                strict: true,
                noEmit: true,
                skipLibCheck: true,
                paths: { '@thunder-solution/sdk': [join(root, 'src', 'index.ts')] },
            },
            files,
        }
        writeFileSync(join(work, 'tsconfig.json'), JSON.stringify(config, null, 2))
        const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
        const result = spawnSync(process.execPath, [tsc, '-p', join(work, 'tsconfig.json')], {
            encoding: 'utf8',
        })
        expect(`${result.stdout}${result.stderr}`, `${files.length} README code blocks`).toBe('')
        expect(result.status).toBe(0)
    } finally {
        rmSync(work, { recursive: true, force: true })
    }
}, 120_000)
