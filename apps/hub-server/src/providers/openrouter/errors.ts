import type { OpenRouterAuditionRecord } from './types.js';

export type OpenRouterAdapterErrorCode =
  | 'INVALID_REQUEST'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'CREDENTIAL_REJECTED'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_CREDITS'
  | 'OPENROUTER_HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'MALFORMED_CATALOG'
  | 'MODEL_NOT_AVAILABLE'
  | 'MODEL_PARAMETERS_UNSUPPORTED'
  | 'CONTEXT_LIMIT_EXCEEDED'
  | 'COST_CAP_TOO_LOW'
  | 'RESERVATION_FAILED'
  | 'RESERVATION_STATE_UNKNOWN'
  | 'MALFORMED_COMPLETION'
  | 'MODEL_MISMATCH'
  | 'COST_CAP_EXCEEDED'
  | 'SETTLEMENT_FAILED'
  | 'INTERNAL_FAILURE';

export interface OpenRouterAdapterErrorOptions {
  readonly retryAfterMs?: number;
  readonly reconciliationRequired?: boolean;
  readonly reservationId?: string;
  readonly record?: OpenRouterAuditionRecord;
}

/** A stable, sanitized error contract. Provider bodies and causes are omitted. */
export class OpenRouterAdapterError extends Error {
  readonly code: OpenRouterAdapterErrorCode;
  readonly retryAfterMs?: number;
  readonly reconciliationRequired: boolean;
  readonly reservationId?: string;
  readonly record?: OpenRouterAuditionRecord;

  constructor(
    code: OpenRouterAdapterErrorCode,
    message: string,
    options: OpenRouterAdapterErrorOptions = {},
  ) {
    super(message);
    this.name = 'OpenRouterAdapterError';
    this.code = code;
    this.reconciliationRequired = options.reconciliationRequired === true;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.reservationId !== undefined) this.reservationId = options.reservationId;
    if (options.record !== undefined) this.record = options.record;
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
      reconciliationRequired: this.reconciliationRequired,
    };
    if (this.retryAfterMs !== undefined) json.retryAfterMs = this.retryAfterMs;
    if (this.reservationId !== undefined) json.reservationId = this.reservationId;
    if (this.record !== undefined) json.record = this.record;
    return json;
  }
}
