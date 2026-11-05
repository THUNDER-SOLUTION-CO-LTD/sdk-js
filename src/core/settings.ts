/** Default hosts, environment variable names and header names the SDK uses. */
export const settings = {
    baseUrls: {
        v1: 'https://api.thunder.in.th/v1',
        v2: 'https://api.thunder.in.th/v2',
    },
    userAgentProduct: 'thunder-slip-js',
    webhook: {
        signatureHeader: 'X-Thunder-Signature',
        signaturePrefix: 'sha256=',
    },
    env: {
        apiKey: 'THUNDER_API_KEY',
        apiKeyFile: 'THUNDER_API_KEY_FILE',
        webhookSecret: 'THUNDER_WEBHOOK_SECRET',
        v1BaseUrl: 'THUNDER_V1_BASE_URL',
        v2BaseUrl: 'THUNDER_V2_BASE_URL',
    },
} as const
