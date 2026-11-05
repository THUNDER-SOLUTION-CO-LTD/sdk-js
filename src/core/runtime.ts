// Small runtime probes that work on Node, Bun, Deno and edge runtimes without type packages.

interface ProcessLike {
    env?: Record<string, string | undefined>
    versions?: { node?: string; bun?: string }
}
interface DenoLike {
    env?: { get(name: string): string | undefined }
    version?: { deno?: string }
}

const g = globalThis as { process?: ProcessLike; Deno?: DenoLike; Bun?: { version?: string } }

/** Reads an environment variable, or undefined when the runtime has none or denies access. */
export function readEnv(name: string): string | undefined {
    try {
        if (g.Deno?.env) return g.Deno.env.get(name) || undefined
        return g.process?.env?.[name] || undefined
    } catch {
        return undefined
    }
}

/** `<runtime>/<version>` for the User-Agent header. */
export function runtimeToken(): string {
    if (g.Bun?.version) return `bun/${g.Bun.version}`
    if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`
    if (g.process?.versions?.node) return `node/${g.process.versions.node}`
    return 'edge/unknown'
}

interface FsPromises {
    readFile(path: string | URL): Promise<Uint8Array>
    stat(path: string | URL): Promise<{ size: number; isFile(): boolean }>
}

let fsPromise: Promise<FsPromises | null> | undefined

/** `node:fs/promises`, or null on runtimes without a file system. */
export function loadFs(): Promise<FsPromises | null> {
    fsPromise ??= import('node:fs/promises' as string).then(
        (mod: FsPromises & { default?: FsPromises }) => mod.default ?? mod,
        () => null,
    )
    return fsPromise
}

/** Waits `ms` milliseconds; rejects with the signal's reason when it aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason)
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal?.reason)
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}
