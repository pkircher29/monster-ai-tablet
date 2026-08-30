export interface OpenRouterAuditionLimits {
  maxCostMicrodollars: number;
  maxTokens: number;
  maxDurationMs: number;
}

/**
 * Internal command accepted after the hub has resolved a model profile to an
 * exact OpenRouter model slug. V1 deliberately exposes no tool payload.
 */
export interface OpenRouterRawAuditionCommand {
  schemaVersion: 1;
  requestId: string;
  mode: 'RAW_MODEL_AUDITION';
  requestedModel: string;
  toolProfileId: 'no-tools@1';
  credentialRef: string;
  prompt: string;
  limits: OpenRouterAuditionLimits;
}

export interface OpenRouterCatalogSnapshotRecord {
  readonly sha256: string;
  readonly capturedAt: string;
  readonly modelId: string;
  readonly contextLength: number;
  readonly promptPricePerToken: string;
  readonly completionPricePerToken: string;
  readonly requestPrice: string;
}

export interface OpenRouterTokenUsageRecord {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export type GenerationMetadataStatus = 'VERIFIED' | 'UNAVAILABLE';

/** Prompt text and credential material must never be added to this record. */
export interface OpenRouterAuditionRecord {
  readonly requestId: string;
  readonly mode: 'RAW_MODEL_AUDITION';
  readonly requestedModel: string;
  readonly actualModel: string;
  readonly generationId: string;
  readonly tokenUsage: OpenRouterTokenUsageRecord;
  readonly latencyMs: number;
  readonly catalogSnapshot: OpenRouterCatalogSnapshotRecord;
  readonly actualCostMicrodollars: number;
  readonly generationMetadataStatus: GenerationMetadataStatus;
  readonly provider?: string;
}

export interface OpenRouterAuditionResult {
  readonly outputText: string;
  readonly record: OpenRouterAuditionRecord;
}

export interface CostReservationRequest {
  readonly requestId: string;
  readonly amountMicrodollars: number;
  readonly estimatedCostMicrodollars: number;
  readonly catalogSnapshotSha256: string;
}

export interface AtomicReservationLedger {
  /** Must atomically create the hold or fail without creating one. */
  reserve(input: CostReservationRequest): Promise<{ readonly reservationId: string }>;
  /** Marks the hold as potentially billable immediately before dispatch. */
  commit(reservationId: string): Promise<void>;
  /** Releases a hold only when the adapter knows no billable completion occurred. */
  rollback(reservationId: string, reason: string): Promise<void>;
  /** Finalizes a committed hold using integer microdollars. */
  settle(reservationId: string, actualCostMicrodollars: number): Promise<void>;
}

/**
 * The resolver owns the secret lifetime. The adapter can use the credential in
 * the callback but cannot return it from its public API.
 */
export interface WindowsCredentialResolver {
  withCredential<T>(credentialRef: string, use: (credential: string) => Promise<T>): Promise<T>;
}

export interface OpenRouterAdapterDependencies {
  /** Inject `globalThis.fetch` in production and a closed fake in tests. */
  readonly fetch: typeof fetch;
  readonly ledger: AtomicReservationLedger;
  readonly credentialResolver: WindowsCredentialResolver;
  readonly now?: () => number;
}

export interface OpenRouterAuditionOptions {
  readonly signal?: AbortSignal;
}

export interface OpenRouterAdapter {
  audition(
    command: OpenRouterRawAuditionCommand | unknown,
    options?: OpenRouterAuditionOptions,
  ): Promise<OpenRouterAuditionResult>;
}
