// Shared helpers of the example scripts. Every example builds its client with `new Client()`,
// which reads the API key (or the key file path) from the env variables named in the README.
import { type AccountType, ApiError } from '@thunder-solution/sdk'

function exitWithUsage(usage: string): never {
    console.error(`usage: node examples/${process.argv[1]?.split('/').pop()} ${usage}`)
    process.exit(2)
}

/** Returns command line argument `index` (0 = first), or prints the usage and exits. */
export function arg(index: number, usage: string): string {
    const value = process.argv[2 + index]
    if (value === undefined || value === '') exitWithUsage(usage)
    return value
}

/** Returns optional argument `index` as NATURAL or JURISTIC, or prints the usage and exits. */
export function accountTypeArg(index: number, usage: string): AccountType | undefined {
    const value = process.argv[2 + index]
    if (value === undefined || value === '') return undefined
    if (value === 'NATURAL' || value === 'JURISTIC') return value
    exitWithUsage(usage)
}

/** Runs an example and prints its result as JSON, or the error and its request id. */
export async function run(main: () => Promise<unknown>): Promise<void> {
    try {
        const result = await main()
        if (result !== undefined) console.log(JSON.stringify(result, null, 2))
    } catch (error) {
        if (error instanceof ApiError) {
            console.error(String(error), `(request id ${error.requestId ?? 'none'})`)
        } else {
            console.error(String(error))
        }
        process.exitCode = 1
    }
}
