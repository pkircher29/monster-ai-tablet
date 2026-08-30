import { OpenRouterAdapterError } from './errors.js';
import type { OpenRouterRawAuditionCommand } from './types.js';

const MAX_PROMPT_LENGTH = 32_768;
const MAX_MODEL_LENGTH = 384;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CREDENTIAL_REF_LENGTH = 256;
const MAX_TOKENS = 1_000_000;
const MAX_DURATION_MS = 600_000;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const CREDENTIAL_REF_PATTERN = /^windows-credential:[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function invalidRequest(): never {
  throw new OpenRouterAdapterError(
    'INVALID_REQUEST',
    'The OpenRouter audition request is invalid.',
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

export function parseRawAuditionCommand(input: unknown): OpenRouterRawAuditionCommand {
  if (!isRecord(input)) invalidRequest();
  if (
    !hasOnlyKeys(input, [
      'schemaVersion',
      'requestId',
      'mode',
      'requestedModel',
      'toolProfileId',
      'credentialRef',
      'prompt',
      'limits',
    ])
  ) {
    invalidRequest();
  }

  if (input.schemaVersion !== 1) invalidRequest();
  if (input.mode !== 'RAW_MODEL_AUDITION') invalidRequest();
  if (input.toolProfileId !== 'no-tools@1') invalidRequest();
  if (
    typeof input.requestId !== 'string' ||
    input.requestId.length === 0 ||
    input.requestId.length > MAX_REQUEST_ID_LENGTH ||
    !REQUEST_ID_PATTERN.test(input.requestId)
  ) {
    invalidRequest();
  }
  if (
    typeof input.requestedModel !== 'string' ||
    input.requestedModel.length === 0 ||
    input.requestedModel.length > MAX_MODEL_LENGTH ||
    !MODEL_PATTERN.test(input.requestedModel)
  ) {
    invalidRequest();
  }
  if (
    typeof input.credentialRef !== 'string' ||
    input.credentialRef.length > MAX_CREDENTIAL_REF_LENGTH ||
    !CREDENTIAL_REF_PATTERN.test(input.credentialRef)
  ) {
    invalidRequest();
  }
  if (
    typeof input.prompt !== 'string' ||
    input.prompt.length === 0 ||
    input.prompt.length > MAX_PROMPT_LENGTH
  ) {
    invalidRequest();
  }
  if (!isRecord(input.limits)) invalidRequest();
  if (
    !hasOnlyKeys(input.limits, ['maxCostMicrodollars', 'maxTokens', 'maxDurationMs']) ||
    !isSafeIntegerInRange(input.limits.maxCostMicrodollars, 0, Number.MAX_SAFE_INTEGER) ||
    !isSafeIntegerInRange(input.limits.maxTokens, 1, MAX_TOKENS) ||
    !isSafeIntegerInRange(input.limits.maxDurationMs, 1, MAX_DURATION_MS)
  ) {
    invalidRequest();
  }

  return {
    schemaVersion: 1,
    requestId: input.requestId,
    mode: 'RAW_MODEL_AUDITION',
    requestedModel: input.requestedModel,
    toolProfileId: 'no-tools@1',
    credentialRef: input.credentialRef,
    prompt: input.prompt,
    limits: {
      maxCostMicrodollars: input.limits.maxCostMicrodollars,
      maxTokens: input.limits.maxTokens,
      maxDurationMs: input.limits.maxDurationMs,
    },
  };
}

export function parseBoundedString(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    return undefined;
  }
  return value;
}

export function parseNonnegativeInteger(value: unknown, maximum: number): number | undefined {
  return isSafeIntegerInRange(value, 0, maximum) ? value : undefined;
}
