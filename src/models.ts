// Response models. Field presence follows the API: an optional field (`?`) can
// be absent, `| null` can be null, and the two are kept apart when a model is serialized again.
// Enum-like fields are open strings: the known values are listed, unknown values still parse.

/** A string union that still accepts values added by the API later. */
export type Open<T extends string> = T | (string & {})

// ---------------------------------------------------------------- info

/** `GET /info`: the application, branch, account and plan behind the API key. */
export interface Info {
    application: InfoApplication
    branch: InfoBranch
    account: InfoAccount
    product: InfoProduct
}

export interface InfoApplication {
    /** Application name. */
    name: string
    autoRenew: AutoRenew
    quota: ApplicationQuota
}

export interface AutoRenew {
    /** Auto renew of the expiry date is on. */
    expired: boolean
    /** Auto renew of the quota is on. */
    quota: boolean
    createdAt: string
    expiresAt: string
}

export interface ApplicationQuota {
    /** Used in the current period. */
    used: number
    /** Period limit, null when unlimited. */
    max: number | null
    /** Left in the current period, null when unlimited. */
    remaining: number | null
    /** Used since the application was created. */
    totalUsed: number
}

export interface InfoBranch {
    name: string
    isActive: boolean
    quota: BranchQuota
}

export interface BranchQuota {
    used: number
    totalUsed: number
}

export interface InfoAccount {
    email: string
    /** Account credit balance. */
    credit: number
}

export interface InfoProduct {
    /** Plan name. */
    name: string
}

// ---------------------------------------------------------------- bank slips

/** A bank transfer slip as the bank reported it. v2 `rawSlip`, v1 verify `data`. */
export interface BankSlip {
    payload: string
    transRef: string
    /** Transfer time, ISO 8601 with offset. */
    date: string
    /** Country code, may be empty. */
    countryCode: string
    amount: SlipAmount
    fee?: number
    ref1?: string
    ref2?: string
    ref3?: string
    sender: SlipParty
    receiver: SlipReceiver
}

export interface SlipAmount {
    amount: number
    local: LocalAmount
}

/** Foreign leg of the transfer; `0` and `''` when there is none. */
export interface LocalAmount {
    amount?: number
    currency?: string
}

export interface SlipParty {
    bank?: SlipBank
    account: SlipAccount
}

export interface SlipReceiver extends SlipParty {
    /** Merchant id; v2 sends it (often empty), v1 leaves it out. */
    merchantId?: string | null
}

export interface SlipBank {
    /**
     * Bank code, for example `004`. Absent when the bank is unknown: v1 then sends the receiver
     * bank as an empty object.
     */
    id?: string
    name?: string
    short?: string
}

export interface SlipAccount {
    name: AccountName
    bank?: AccountNumber
    proxy?: AccountNumber
}

/** Account holder name. v2 may send empty strings, v1 leaves empty names out. */
export interface AccountName {
    th?: string
    en?: string
}

/** A masked account number or proxy id. */
export interface AccountNumber {
    /** `BANKAC`, `TOKEN`, `DUMMY` for accounts; `NATID`, `MSISDN`, `EWALLETID`, `EMAIL`, `BILLERID` for proxies. */
    type: Open<
        'BANKAC' | 'TOKEN' | 'DUMMY' | 'NATID' | 'MSISDN' | 'EWALLETID' | 'EMAIL' | 'BILLERID'
    >
    account: string
}

/** Known values of {@link MatchedAccount.type}. */
export const MatchedAccountType = {
    Personal: 'PERSONAL',
    Natural: 'NATURAL',
    Juristic: 'JURISTIC',
} as const

/** The registered bank account the slip's receiver matched (`matchAccount: true`). */
export interface MatchedAccount {
    bank: MatchedBank
    nameTh: string
    nameEn: string
    /** `PERSONAL`, `NATURAL` or `JURISTIC`. */
    type: Open<(typeof MatchedAccountType)[keyof typeof MatchedAccountType]>
    bankNumber: string
}

export interface MatchedBank {
    nameTh?: string
    nameEn?: string
    code?: string
    shortCode?: string
}

/** v2 bank slip verification result. Also the `data` of finished jobs and webhooks. */
export interface BankSlipResult {
    /** Echo of the `remark` option. Absent when not sent. */
    remark?: string
    /** Present only with `checkDuplicate: true`. */
    isDuplicate?: boolean
    /** Absent without `matchAccount`; null when no registered account matched. */
    matchedAccount?: MatchedAccount | null
    /** Present only with `matchAmount`. */
    amountInOrder?: number
    amountInSlip: number
    /** Present only with `matchAmount`. */
    isAmountMatched?: boolean
    rawSlip: BankSlip
}

// ---------------------------------------------------------------- TrueMoney Wallet

/** A TrueMoney Wallet slip. v2 `rawSlip`, v1 TrueMoney `data`. */
export interface TrueWalletSlip {
    transactionId: string
    date: string
    amount: number
    sender: TrueWalletSender
    receiver: TrueWalletReceiver
}

export interface TrueWalletSender {
    name: string
}

export interface TrueWalletReceiver {
    name: string
    /** Masked phone number. */
    phone: string
}

/** v2 TrueMoney Wallet verification result. Same options as {@link BankSlipResult}. */
export interface TrueWalletResult {
    remark?: string
    isDuplicate?: boolean
    matchedAccount?: MatchedAccount | null
    amountInOrder?: number
    amountInSlip: number
    isAmountMatched?: boolean
    rawSlip: TrueWalletSlip
}

// ---------------------------------------------------------------- banks and bank accounts

/** A bank or receiving kind from `GET /banks`. */
export interface Bank {
    code: string
    nameTh: string
    nameEn: string
    shortCode: string
    swiftCode: string
    /** Allowed `extraVerify` values for accounts at this bank, or null. */
    extraVerify: ExtraVerifyOption[] | null
}

export interface ExtraVerifyOption {
    value: string
    label: string
}

/** `GET /banks`. Iterable; serializes to the plain array the API sends. */
export class BankList implements Iterable<Bank> {
    /** The banks, ordered by code. */
    readonly items: Bank[]

    constructor(items: Bank[]) {
        this.items = items
    }

    /** Number of entries. */
    get length(): number {
        return this.items.length
    }

    /** Finds an entry by code, for example `004`. */
    find(code: string): Bank | undefined {
        return this.items.find((bank) => bank.code === code)
    }

    [Symbol.iterator](): Iterator<Bank> {
        return this.items[Symbol.iterator]()
    }

    toJSON(): Bank[] {
        return this.items
    }
}

/** Known values of {@link BankAccount.type}. */
export const BankAccountType = {
    Natural: 'NATURAL',
    Juristic: 'JURISTIC',
} as const

/** Known values of {@link BankAccount.matchMode}. */
export const MatchMode = {
    Name: 'NAME',
    Number: 'NUMBER',
    NameNumber: 'NAME_NUMBER',
} as const

/** A receiving bank account registered on the service. */
export interface BankAccount {
    id: number
    bankCode: string
    bankNumber: string
    nameTh: string
    nameEn: string
    /** `NATURAL` or `JURISTIC`. */
    type: Open<(typeof BankAccountType)[keyof typeof BankAccountType]>
    extraVerify: string | null
    /** PromptPay matching rule, null for other banks. */
    matchMode: Open<(typeof MatchMode)[keyof typeof MatchMode]> | null
    createdAt: string
    updatedAt: string
    deletedAt: string | null
}

/** One page of bank accounts. */
export interface BankAccountPage {
    items: BankAccount[]
    total: number
    page: number
    limit: number
}

export interface LinkResult {
    linked: boolean
}

export interface UnlinkResult {
    unlinked: boolean
}

// ---------------------------------------------------------------- async jobs

export interface JobSubmission {
    jobId: string
}

export interface BatchSubmission {
    batchId: string
    jobs: BatchJob[]
}

export interface BatchJob {
    jobId: string
    /** 0-based position in the submitted list. */
    index: number
}

/** Known values of {@link Job.status}. */
export const JobStatus = {
    Queued: 'queued',
    Processing: 'processing',
    Retrying: 'retrying',
    Done: 'done',
    Failed: 'failed',
} as const

/** An async verification job. Finished when `status` is `done` or `failed`. */
export interface Job {
    jobId: string
    /** Absent for single jobs. */
    batchId?: string
    status: Open<(typeof JobStatus)[keyof typeof JobStatus]>
    result?: JobResult
    error?: JobError
    attempts: number
    createdAt: string
    updatedAt: string
    branchId?: number
    serviceId?: number
    callbackEventId?: string
    callbackProtocol?: number
    callbackDelivery?: CallbackDelivery
}

export interface JobResult {
    /** `success` or `not_found`. */
    status: Open<'success' | 'not_found'>
    /** Null for `not_found`. */
    data: BankSlipResult | null
}

export interface JobError {
    code?: string
    message?: string
    webhook?: string
    url?: string
    status?: number
    at?: string
}

export interface CallbackDelivery {
    state: string | null
    httpStatus: number | null
}

// ---------------------------------------------------------------- webhooks

/** Body of the webhook the API posts when an async job finishes. */
export interface WebhookEvent {
    jobId: string
    /** Null for single jobs. */
    batchId: string | null
    /** `success`, `not_found` or `failed`. */
    status: Open<'success' | 'not_found' | 'failed'>
    /** Null for `not_found` and `failed`. */
    data: BankSlipResult | null
    /** Only on `failed`. */
    error?: WebhookError
    timestamp: string
}

export interface WebhookError {
    code: string
    message: string
}

// ---------------------------------------------------------------- v1

/** v1 `GET /me`. */
export interface V1Me {
    application: string
    usedQuota: number
    maxQuota: number | null
    remainingQuota: number | null
    expiredAt: string | null
    currentCredit: number
}

/** v1 `POST /qr/generate` result. */
export interface QrCode {
    /** Base64 PNG, no data URI prefix. */
    image: string
    mime: string
    /** The EMVCo payload encoded in the QR. */
    payload: string
}

// ---------------------------------------------------------------- parsing

// A shape lists the known keys of a model: 0 copies the value as is, a nested shape recurses,
// [spec] maps an array. Unknown keys are dropped, absent keys stay absent, nulls stay null.
type Spec = 0 | Shape | readonly [Spec]
interface Shape {
    readonly [key: string]: Spec
}
type ShapeOf<T> = { readonly [K in keyof Required<T>]: Spec }

export function pick(spec: Spec, raw: unknown): unknown {
    if (spec === 0 || raw === null || typeof raw !== 'object') return raw
    if (Array.isArray(spec)) {
        const item = (spec as readonly [Spec])[0]
        return Array.isArray(raw) ? raw.map((value) => pick(item, value)) : raw
    }
    if (Array.isArray(raw)) return raw
    const shape = spec as Shape
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) {
        const child = shape[key]
        if (child !== undefined && Object.hasOwn(shape, key)) out[key] = pick(child, value)
    }
    return out
}

const autoRenew: ShapeOf<AutoRenew> = { expired: 0, quota: 0, createdAt: 0, expiresAt: 0 }
const applicationQuota: ShapeOf<ApplicationQuota> = { used: 0, max: 0, remaining: 0, totalUsed: 0 }
const infoShape: ShapeOf<Info> = {
    application: { name: 0, autoRenew, quota: applicationQuota } satisfies ShapeOf<InfoApplication>,
    branch: {
        name: 0,
        isActive: 0,
        quota: { used: 0, totalUsed: 0 } satisfies ShapeOf<BranchQuota>,
    } satisfies ShapeOf<InfoBranch>,
    account: { email: 0, credit: 0 } satisfies ShapeOf<InfoAccount>,
    product: { name: 0 } satisfies ShapeOf<InfoProduct>,
}

const accountNumber: ShapeOf<AccountNumber> = { type: 0, account: 0 }
const slipAccount: ShapeOf<SlipAccount> = {
    name: { th: 0, en: 0 } satisfies ShapeOf<AccountName>,
    bank: accountNumber,
    proxy: accountNumber,
}
const slipBank: ShapeOf<SlipBank> = { id: 0, name: 0, short: 0 }
const slipParty: ShapeOf<SlipParty> = { bank: slipBank, account: slipAccount }
const bankSlipShape: ShapeOf<BankSlip> = {
    payload: 0,
    transRef: 0,
    date: 0,
    countryCode: 0,
    amount: {
        amount: 0,
        local: { amount: 0, currency: 0 } satisfies ShapeOf<LocalAmount>,
    } satisfies ShapeOf<SlipAmount>,
    fee: 0,
    ref1: 0,
    ref2: 0,
    ref3: 0,
    sender: slipParty,
    receiver: { ...slipParty, merchantId: 0 } satisfies ShapeOf<SlipReceiver>,
}
const matchedAccount: ShapeOf<MatchedAccount> = {
    bank: { nameTh: 0, nameEn: 0, code: 0, shortCode: 0 } satisfies ShapeOf<MatchedBank>,
    nameTh: 0,
    nameEn: 0,
    type: 0,
    bankNumber: 0,
}
const bankSlipResultShape: ShapeOf<BankSlipResult> = {
    remark: 0,
    isDuplicate: 0,
    matchedAccount,
    amountInOrder: 0,
    amountInSlip: 0,
    isAmountMatched: 0,
    rawSlip: bankSlipShape,
}
const trueWalletSlipShape: ShapeOf<TrueWalletSlip> = {
    transactionId: 0,
    date: 0,
    amount: 0,
    sender: { name: 0 } satisfies ShapeOf<TrueWalletSender>,
    receiver: { name: 0, phone: 0 } satisfies ShapeOf<TrueWalletReceiver>,
}
const trueWalletResultShape: ShapeOf<TrueWalletResult> = {
    ...bankSlipResultShape,
    rawSlip: trueWalletSlipShape,
}
const bankShape: ShapeOf<Bank> = {
    code: 0,
    nameTh: 0,
    nameEn: 0,
    shortCode: 0,
    swiftCode: 0,
    extraVerify: [{ value: 0, label: 0 } satisfies ShapeOf<ExtraVerifyOption>],
}
const bankAccountShape: ShapeOf<BankAccount> = {
    id: 0,
    bankCode: 0,
    bankNumber: 0,
    nameTh: 0,
    nameEn: 0,
    type: 0,
    extraVerify: 0,
    matchMode: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: 0,
}
const bankAccountPageShape: ShapeOf<BankAccountPage> = {
    items: [bankAccountShape],
    total: 0,
    page: 0,
    limit: 0,
}
const jobShape: ShapeOf<Job> = {
    jobId: 0,
    batchId: 0,
    status: 0,
    result: { status: 0, data: bankSlipResultShape } satisfies ShapeOf<JobResult>,
    error: {
        code: 0,
        message: 0,
        webhook: 0,
        url: 0,
        status: 0,
        at: 0,
    } satisfies ShapeOf<JobError>,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    branchId: 0,
    serviceId: 0,
    callbackEventId: 0,
    callbackProtocol: 0,
    callbackDelivery: { state: 0, httpStatus: 0 } satisfies ShapeOf<CallbackDelivery>,
}
const webhookEventShape: ShapeOf<WebhookEvent> = {
    jobId: 0,
    batchId: 0,
    status: 0,
    data: bankSlipResultShape,
    error: { code: 0, message: 0 } satisfies ShapeOf<WebhookError>,
    timestamp: 0,
}

/** Model name to shape, for every model a response can decode into. */
export const shapes = {
    Info: infoShape,
    BankSlip: bankSlipShape,
    BankSlipResult: bankSlipResultShape,
    TrueWalletSlip: trueWalletSlipShape,
    TrueWalletResult: trueWalletResultShape,
    BankAccount: bankAccountShape,
    BankAccountPage: bankAccountPageShape,
    LinkResult: { linked: 0 } satisfies ShapeOf<LinkResult>,
    UnlinkResult: { unlinked: 0 } satisfies ShapeOf<UnlinkResult>,
    JobSubmission: { jobId: 0 } satisfies ShapeOf<JobSubmission>,
    BatchSubmission: {
        batchId: 0,
        jobs: [{ jobId: 0, index: 0 } satisfies ShapeOf<BatchJob>],
    } satisfies ShapeOf<BatchSubmission>,
    Job: jobShape,
    WebhookEvent: webhookEventShape,
    V1Me: {
        application: 0,
        usedQuota: 0,
        maxQuota: 0,
        remainingQuota: 0,
        expiredAt: 0,
        currentCredit: 0,
    } satisfies ShapeOf<V1Me>,
    QrCode: { image: 0, mime: 0, payload: 0 } satisfies ShapeOf<QrCode>,
} as const

/** Names of the models {@link parseModel} can build. */
export type ModelName = keyof typeof shapes | 'BankList'

interface ModelTypes {
    Info: Info
    BankSlip: BankSlip
    BankSlipResult: BankSlipResult
    TrueWalletSlip: TrueWalletSlip
    TrueWalletResult: TrueWalletResult
    BankAccount: BankAccount
    BankAccountPage: BankAccountPage
    LinkResult: LinkResult
    UnlinkResult: UnlinkResult
    JobSubmission: JobSubmission
    BatchSubmission: BatchSubmission
    Job: Job
    WebhookEvent: WebhookEvent
    V1Me: V1Me
    QrCode: QrCode
    BankList: BankList
}

/** Builds a model from decoded JSON, keeping only the fields the model knows. */
export function parseModel<N extends ModelName>(name: N, raw: unknown): ModelTypes[N] {
    if (name === 'BankList') {
        const items = Array.isArray(raw) ? (pick([bankShape], raw) as Bank[]) : []
        return new BankList(items) as ModelTypes[N]
    }
    const value = pick(shapes[name as keyof typeof shapes], raw)
    if (value === null || typeof value !== 'object') {
        return {} as ModelTypes[N]
    }
    return value as ModelTypes[N]
}
