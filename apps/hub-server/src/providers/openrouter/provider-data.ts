import { createHash } from 'node:crypto';

import { OpenRouterAdapterError, type OpenRouterAdapterErrorCode } from './errors.js';
import type {
  OpenRouterCatalogSnapshotRecord,
  OpenRouterRawAuditionCommand,
  OpenRouterTokenUsageRecord,
} from './types.js';
import { isRecord, parseBoundedString, parseNonnegativeInteger } from './validation.js';

export const CATALOG_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
export const COMPLETION_BODY_LIMIT_BYTES = 1024 * 1024;
export const GENERATION_BODY_LIMIT_BYTES = 512 * 1024;

const MAX_CATALOG_MODELS = 2_000;
const MAX_MODEL_ID_LENGTH = 384;
const MAX_CONTEXT_LENGTH = 10_000_000;
const MAX_SUPPORTED_PARAMETERS = 256;
const MAX_OUTPUT_LENGTH = 512 * 1024;
const MAX_GENERATION_ID_LENGTH = 256;
const MAX_TOKEN_COUNT = 1_000_000_000;
const MAX_PROVIDER_NAME_LENGTH = 128;
const PRICE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const PROVIDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()/+-]*$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface BoundedJsonBody {
  readonly value: unknown;
  readonly bytes: Uint8Array;
}

export async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  malformedCode: OpenRouterAdapterErrorCode,
): Promise<BoundedJsonBody> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new OpenRouterAdapterError(malformedCode, 'OpenRouter returned an invalid response.');
    }
    if (parsedLength > maximumBytes) {
      throw new OpenRouterAdapterError(
        'RESPONSE_TOO_LARGE',
        'OpenRouter returned a response larger than the configured limit.',
      );
    }
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new OpenRouterAdapterError(malformedCode, 'OpenRouter returned an invalid response.');
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OpenRouterAdapterError(
        'RESPONSE_TOO_LARGE',
        'OpenRouter returned a response larger than the configured limit.',
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { value: JSON.parse(text) as unknown, bytes };
  } catch {
    throw new OpenRouterAdapterError(malformedCode, 'OpenRouter returned an invalid response.');
  }
}

interface CatalogModel {
  readonly id: string;
  readonly contextLength: number;
  readonly promptPrice: string;
  readonly completionPrice: string;
  readonly requestPrice: string;
  readonly maximumCompletionTokens?: number;
}

export interface ParsedCatalogSelection {
  readonly model: CatalogModel;
  readonly snapshot: OpenRouterCatalogSnapshotRecord;
  readonly estimatedCostMicrodollars: number;
}

function parsePrice(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64 || !PRICE_PATTERN.test(value)) {
    return undefined;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return undefined;
  return value;
}

function dollarsToMicrodollarsCeiling(dollars: number): number | undefined {
  if (!Number.isFinite(dollars) || dollars < 0) return undefined;
  const microdollars = Math.ceil(dollars * 1_000_000);
  return Number.isSafeInteger(microdollars) ? microdollars : undefined;
}

export function parseCatalogSelection(
  body: BoundedJsonBody,
  command: OpenRouterRawAuditionCommand,
  capturedAtMs: number,
): ParsedCatalogSelection {
  if (!isRecord(body.value) || !Array.isArray(body.value.data)) {
    throw new OpenRouterAdapterError(
      'MALFORMED_CATALOG',
      'OpenRouter returned an invalid catalog.',
    );
  }
  if (body.value.data.length > MAX_CATALOG_MODELS) {
    throw new OpenRouterAdapterError(
      'MALFORMED_CATALOG',
      'OpenRouter returned an invalid catalog.',
    );
  }

  const matches = body.value.data.filter(
    (candidate) => isRecord(candidate) && candidate.id === command.requestedModel,
  );
  if (matches.length === 0) {
    throw new OpenRouterAdapterError(
      'MODEL_NOT_AVAILABLE',
      'The requested OpenRouter model is not in the current catalog.',
    );
  }
  if (matches.length !== 1) {
    throw new OpenRouterAdapterError(
      'MALFORMED_CATALOG',
      'OpenRouter returned an invalid catalog.',
    );
  }

  const target = matches[0];
  if (!isRecord(target)) {
    throw new OpenRouterAdapterError(
      'MALFORMED_CATALOG',
      'OpenRouter returned an invalid catalog.',
    );
  }
  const id = parseBoundedString(target.id, MAX_MODEL_ID_LENGTH);
  const contextLength = parseNonnegativeInteger(target.context_length, MAX_CONTEXT_LENGTH);
  const pricing = target.pricing;
  const supportedParameters = target.supported_parameters;
  if (
    id === undefined ||
    contextLength === undefined ||
    contextLength === 0 ||
    !isRecord(pricing) ||
    !Array.isArray(supportedParameters) ||
    supportedParameters.length > MAX_SUPPORTED_PARAMETERS ||
    !supportedParameters.every(
      (parameter) =>
        typeof parameter === 'string' && parameter.length > 0 && parameter.length <= 128,
    )
  ) {
    throw new OpenRouterAdapterError(
      'MALFORMED_CATALOG',
      'OpenRouter returned an invalid catalog.',
    );
  }

  const promptPrice = parsePrice(pricing.prompt);
  const completionPrice = parsePrice(pricing.completion);
  const requestPrice = parsePrice(pricing.request);
  if (promptPrice === undefined || completionPrice === undefined || requestPrice === undefined) {
    throw new OpenRouterAdapterError(
      'MALFORMED_CATALOG',
      'OpenRouter returned an invalid catalog.',
    );
  }
  if (!supportedParameters.includes('max_tokens')) {
    throw new OpenRouterAdapterError(
      'MODEL_PARAMETERS_UNSUPPORTED',
      'The requested model does not advertise the required parameters.',
    );
  }

  let maximumCompletionTokens: number | undefined;
  if (target.top_provider !== null && target.top_provider !== undefined) {
    if (!isRecord(target.top_provider)) {
      throw new OpenRouterAdapterError(
        'MALFORMED_CATALOG',
        'OpenRouter returned an invalid catalog.',
      );
    }
    if (target.top_provider.max_completion_tokens !== null) {
      maximumCompletionTokens = parseNonnegativeInteger(
        target.top_provider.max_completion_tokens,
        MAX_CONTEXT_LENGTH,
      );
      if (maximumCompletionTokens === undefined || maximumCompletionTokens === 0) {
        throw new OpenRouterAdapterError(
          'MALFORMED_CATALOG',
          'OpenRouter returned an invalid catalog.',
        );
      }
    }
  }
  if (maximumCompletionTokens !== undefined && command.limits.maxTokens > maximumCompletionTokens) {
    throw new OpenRouterAdapterError(
      'MODEL_PARAMETERS_UNSUPPORTED',
      'The requested output limit exceeds the model catalog limit.',
    );
  }

  // UTF-8 bytes upper-bound prompt tokenizer pieces; the fixed allowance covers
  // message framing without retaining or recording prompt text.
  const promptTokenUpperBound = new TextEncoder().encode(command.prompt).byteLength + 1_024;
  if (promptTokenUpperBound + command.limits.maxTokens > contextLength) {
    throw new OpenRouterAdapterError(
      'CONTEXT_LIMIT_EXCEEDED',
      'The bounded request can exceed the current model context limit.',
    );
  }
  const estimatedDollars =
    Number(requestPrice) +
    Number(promptPrice) * promptTokenUpperBound +
    Number(completionPrice) * command.limits.maxTokens;
  const estimatedCostMicrodollars = dollarsToMicrodollarsCeiling(estimatedDollars);
  if (estimatedCostMicrodollars === undefined) {
    throw new OpenRouterAdapterError('MALFORMED_CATALOG', 'OpenRouter returned invalid pricing.');
  }
  if (estimatedCostMicrodollars > command.limits.maxCostMicrodollars) {
    throw new OpenRouterAdapterError(
      'COST_CAP_TOO_LOW',
      'The current catalog estimate exceeds the approved cost cap.',
    );
  }

  if (!Number.isFinite(capturedAtMs)) {
    throw new OpenRouterAdapterError('INTERNAL_FAILURE', 'The host clock is unavailable.');
  }
  const snapshotSha256 = createHash('sha256').update(body.bytes).digest('hex');
  const model: CatalogModel = {
    id,
    contextLength,
    promptPrice,
    completionPrice,
    requestPrice,
    ...(maximumCompletionTokens === undefined ? {} : { maximumCompletionTokens }),
  };
  return {
    model,
    estimatedCostMicrodollars,
    snapshot: {
      sha256: snapshotSha256,
      capturedAt: new Date(capturedAtMs).toISOString(),
      modelId: id,
      contextLength,
      promptPricePerToken: promptPrice,
      completionPricePerToken: completionPrice,
      requestPrice,
    },
  };
}

export interface ParsedCompletion {
  readonly generationId: string;
  readonly actualModel: string;
  readonly outputText: string;
  readonly tokenUsage: OpenRouterTokenUsageRecord;
  readonly costMicrodollars: number;
}

export function parseCompletion(body: BoundedJsonBody): ParsedCompletion {
  if (!isRecord(body.value)) {
    throw new OpenRouterAdapterError(
      'MALFORMED_COMPLETION',
      'OpenRouter returned an invalid completion.',
    );
  }
  const generationId = parseBoundedString(
    body.value.id,
    MAX_GENERATION_ID_LENGTH,
    GENERATION_ID_PATTERN,
  );
  const actualModel = parseBoundedString(body.value.model, MAX_MODEL_ID_LENGTH, MODEL_ID_PATTERN);
  const choices = body.value.choices;
  const usage = body.value.usage;
  if (
    generationId === undefined ||
    actualModel === undefined ||
    !Array.isArray(choices) ||
    choices.length === 0 ||
    choices.length > 8 ||
    !isRecord(choices[0]) ||
    !isRecord(choices[0].message) ||
    choices[0].message.role !== 'assistant' ||
    typeof choices[0].message.content !== 'string' ||
    choices[0].message.content.length > MAX_OUTPUT_LENGTH ||
    !isRecord(usage)
  ) {
    throw new OpenRouterAdapterError(
      'MALFORMED_COMPLETION',
      'OpenRouter returned an invalid completion.',
    );
  }
  const promptTokens = parseNonnegativeInteger(usage.prompt_tokens, MAX_TOKEN_COUNT);
  const completionTokens = parseNonnegativeInteger(usage.completion_tokens, MAX_TOKEN_COUNT);
  const totalTokens = parseNonnegativeInteger(usage.total_tokens, MAX_TOKEN_COUNT);
  if (
    promptTokens === undefined ||
    completionTokens === undefined ||
    totalTokens === undefined ||
    totalTokens !== promptTokens + completionTokens ||
    typeof usage.cost !== 'number'
  ) {
    throw new OpenRouterAdapterError(
      'MALFORMED_COMPLETION',
      'OpenRouter returned invalid usage accounting.',
    );
  }
  const costMicrodollars = dollarsToMicrodollarsCeiling(usage.cost);
  if (costMicrodollars === undefined) {
    throw new OpenRouterAdapterError(
      'MALFORMED_COMPLETION',
      'OpenRouter returned invalid usage accounting.',
    );
  }

  return {
    generationId,
    actualModel,
    outputText: choices[0].message.content,
    tokenUsage: { promptTokens, completionTokens, totalTokens },
    costMicrodollars,
  };
}

export interface ParsedGenerationMetadata {
  readonly model: string;
  readonly costMicrodollars: number;
  readonly provider?: string;
}

export function parseGenerationMetadata(
  body: BoundedJsonBody,
  expectedGenerationId: string,
): ParsedGenerationMetadata | undefined {
  if (!isRecord(body.value) || !isRecord(body.value.data)) return undefined;
  const id = parseBoundedString(
    body.value.data.id,
    MAX_GENERATION_ID_LENGTH,
    GENERATION_ID_PATTERN,
  );
  const model = parseBoundedString(body.value.data.model, MAX_MODEL_ID_LENGTH, MODEL_ID_PATTERN);
  if (id !== expectedGenerationId || model === undefined) return undefined;
  if (typeof body.value.data.total_cost !== 'number') return undefined;
  const costMicrodollars = dollarsToMicrodollarsCeiling(body.value.data.total_cost);
  if (costMicrodollars === undefined) return undefined;

  const provider = parseBoundedString(
    body.value.data.provider_name,
    MAX_PROVIDER_NAME_LENGTH,
    PROVIDER_NAME_PATTERN,
  );
  return {
    model,
    costMicrodollars,
    ...(provider === undefined ? {} : { provider }),
  };
}
