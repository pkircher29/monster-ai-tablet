import { OpenRouterAdapterError } from './errors.js';
import {
  CATALOG_BODY_LIMIT_BYTES,
  COMPLETION_BODY_LIMIT_BYTES,
  GENERATION_BODY_LIMIT_BYTES,
  parseCatalogSelection,
  parseCompletion,
  parseGenerationMetadata,
  readBoundedJson,
} from './provider-data.js';
import type {
  AtomicReservationLedger,
  OpenRouterAdapter,
  OpenRouterAdapterDependencies,
  OpenRouterAuditionOptions,
  OpenRouterAuditionRecord,
  OpenRouterRawAuditionCommand,
} from './types.js';
import { parseBoundedString, parseRawAuditionCommand } from './validation.js';

const OPENROUTER_ORIGIN = 'https://openrouter.ai';
const MODELS_URL = `${OPENROUTER_ORIGIN}/api/v1/models`;
const COMPLETIONS_URL = `${OPENROUTER_ORIGIN}/api/v1/chat/completions`;
const GENERATION_URL = `${OPENROUTER_ORIGIN}/api/v1/generation`;
const MAX_CREDENTIAL_LENGTH = 8_192;
const MAX_RESERVATION_ID_LENGTH = 256;
const RESERVATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

interface Deadline {
  readonly signal: AbortSignal;
  readonly didTimeOut: () => boolean;
  readonly cleanup: () => void;
}

function createDeadline(durationMs: number, externalSignal?: AbortSignal): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, durationMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

function retryAfterMs(response: Response, now: () => number): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const milliseconds = Number(value) * 1_000;
    return Number.isSafeInteger(milliseconds) && milliseconds <= 24 * 60 * 60 * 1_000
      ? milliseconds
      : undefined;
  }
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  const milliseconds = Math.max(0, Math.ceil(retryAt - now()));
  return milliseconds <= 24 * 60 * 60 * 1_000 ? milliseconds : undefined;
}

function httpError(response: Response, now: () => number): OpenRouterAdapterError {
  if (response.status === 402) {
    return new OpenRouterAdapterError(
      'INSUFFICIENT_CREDITS',
      'OpenRouter rejected the request because the inference key lacks credits.',
    );
  }
  if (response.status === 429) {
    const retry = retryAfterMs(response, now);
    return new OpenRouterAdapterError(
      'RATE_LIMITED',
      'OpenRouter rate-limited the request.',
      retry === undefined ? {} : { retryAfterMs: retry },
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new OpenRouterAdapterError(
      'CREDENTIAL_REJECTED',
      'OpenRouter rejected the configured credential.',
    );
  }
  if (response.status === 408 || response.status === 504 || response.status === 524) {
    return new OpenRouterAdapterError('TIMEOUT', 'OpenRouter reported that the request timed out.');
  }
  return new OpenRouterAdapterError('OPENROUTER_HTTP_ERROR', 'OpenRouter rejected the request.');
}

function interruptedError(
  deadline: Deadline,
  externalSignal: AbortSignal | undefined,
  reservationId?: string,
): OpenRouterAdapterError {
  const options =
    reservationId === undefined ? {} : { reconciliationRequired: true, reservationId };
  if (deadline.didTimeOut()) {
    return new OpenRouterAdapterError('TIMEOUT', 'The OpenRouter audition timed out.', options);
  }
  if (externalSignal?.aborted === true || deadline.signal.aborted) {
    return new OpenRouterAdapterError(
      'CANCELLED',
      'The OpenRouter audition was cancelled.',
      options,
    );
  }
  return new OpenRouterAdapterError(
    'NETWORK_ERROR',
    'The OpenRouter request did not complete.',
    options,
  );
}

function authenticatedHeaders(credential: string, includeContentType = false): HeadersInit {
  return {
    accept: 'application/json',
    authorization: `Bearer ${credential}`,
    ...(includeContentType ? { 'content-type': 'application/json' } : {}),
  };
}

async function rollbackKnownNoCharge(
  ledger: AtomicReservationLedger,
  reservationId: string,
  reason: string,
): Promise<void> {
  try {
    await ledger.rollback(reservationId, reason);
  } catch {
    throw new OpenRouterAdapterError(
      'RESERVATION_STATE_UNKNOWN',
      'The cost reservation could not be safely released.',
      { reconciliationRequired: true, reservationId },
    );
  }
}

function withCommittedReservation(
  error: OpenRouterAdapterError,
  reservationId: string,
): OpenRouterAdapterError {
  return new OpenRouterAdapterError(error.code, error.message, {
    reconciliationRequired: true,
    reservationId,
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    ...(error.record === undefined ? {} : { record: error.record }),
  });
}

async function fetchGenerationMetadata(
  dependencies: OpenRouterAdapterDependencies,
  credential: string,
  generationId: string,
  signal: AbortSignal,
) {
  if (signal.aborted) return undefined;
  try {
    const response = await dependencies.fetch(
      `${GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
      {
        method: 'GET',
        headers: authenticatedHeaders(credential),
        cache: 'no-store',
        redirect: 'error',
        signal,
      },
    );
    if (!response.ok) return undefined;
    const body = await readBoundedJson(
      response,
      GENERATION_BODY_LIMIT_BYTES,
      'MALFORMED_COMPLETION',
    );
    return parseGenerationMetadata(body, generationId);
  } catch {
    // Completion usage remains the accounting fallback. Metadata is an audit
    // enhancement and must not strand a completed paid request.
    return undefined;
  }
}

export function createOpenRouterAdapter(
  dependencies: OpenRouterAdapterDependencies,
): OpenRouterAdapter {
  if (
    typeof dependencies.fetch !== 'function' ||
    (typeof dependencies.now !== 'function' && dependencies.now !== undefined) ||
    typeof dependencies.ledger?.reserve !== 'function' ||
    typeof dependencies.ledger?.commit !== 'function' ||
    typeof dependencies.ledger?.rollback !== 'function' ||
    typeof dependencies.ledger?.settle !== 'function' ||
    typeof dependencies.credentialResolver?.withCredential !== 'function'
  ) {
    throw new OpenRouterAdapterError(
      'INTERNAL_FAILURE',
      'The OpenRouter adapter dependencies are invalid.',
    );
  }
  const now = dependencies.now ?? Date.now;

  return {
    async audition(
      input: OpenRouterRawAuditionCommand | unknown,
      options: OpenRouterAuditionOptions = {},
    ) {
      const command = parseRawAuditionCommand(input);
      if (options.signal?.aborted === true) {
        throw new OpenRouterAdapterError('CANCELLED', 'The OpenRouter audition was cancelled.');
      }
      const deadline = createDeadline(command.limits.maxDurationMs, options.signal);
      let credentialCallbackEntered = false;

      try {
        return await dependencies.credentialResolver.withCredential(
          command.credentialRef,
          async (credential) => {
            credentialCallbackEntered = true;
            if (
              typeof credential !== 'string' ||
              credential.length === 0 ||
              credential.length > MAX_CREDENTIAL_LENGTH
            ) {
              throw new OpenRouterAdapterError(
                'CREDENTIAL_UNAVAILABLE',
                'The configured OpenRouter credential is unavailable.',
              );
            }
            if (deadline.signal.aborted) {
              throw interruptedError(deadline, options.signal);
            }

            let catalogResponse: Response;
            try {
              catalogResponse = await dependencies.fetch(MODELS_URL, {
                method: 'GET',
                headers: authenticatedHeaders(credential),
                cache: 'no-store',
                redirect: 'error',
                signal: deadline.signal,
              });
            } catch {
              throw interruptedError(deadline, options.signal);
            }
            if (!catalogResponse.ok) throw httpError(catalogResponse, now);
            let catalogBody;
            try {
              catalogBody = await readBoundedJson(
                catalogResponse,
                CATALOG_BODY_LIMIT_BYTES,
                'MALFORMED_CATALOG',
              );
            } catch (error) {
              if (deadline.signal.aborted) {
                throw interruptedError(deadline, options.signal);
              }
              throw error;
            }
            const catalog = parseCatalogSelection(catalogBody, command, now());

            let reservationId: string;
            try {
              const reservation = await dependencies.ledger.reserve({
                requestId: command.requestId,
                amountMicrodollars: command.limits.maxCostMicrodollars,
                estimatedCostMicrodollars: catalog.estimatedCostMicrodollars,
                catalogSnapshotSha256: catalog.snapshot.sha256,
              });
              const parsedReservationId = parseBoundedString(
                reservation.reservationId,
                MAX_RESERVATION_ID_LENGTH,
                RESERVATION_ID_PATTERN,
              );
              if (parsedReservationId === undefined) {
                throw new Error('invalid reservation identifier');
              }
              reservationId = parsedReservationId;
            } catch {
              throw new OpenRouterAdapterError(
                'RESERVATION_FAILED',
                'The approved cost could not be reserved atomically.',
              );
            }

            if (deadline.signal.aborted) {
              await rollbackKnownNoCharge(
                dependencies.ledger,
                reservationId,
                deadline.didTimeOut() ? 'TIMEOUT_BEFORE_DISPATCH' : 'CANCELLED_BEFORE_DISPATCH',
              );
              throw interruptedError(deadline, options.signal);
            }
            try {
              await dependencies.ledger.commit(reservationId);
            } catch {
              await rollbackKnownNoCharge(
                dependencies.ledger,
                reservationId,
                'COMMIT_FAILED_BEFORE_DISPATCH',
              );
              throw new OpenRouterAdapterError(
                'RESERVATION_FAILED',
                'The approved cost reservation could not be committed.',
              );
            }

            const dispatchStartedAt = now();
            let completionResponse: Response;
            try {
              completionResponse = await dependencies.fetch(COMPLETIONS_URL, {
                method: 'POST',
                headers: authenticatedHeaders(credential, true),
                cache: 'no-store',
                redirect: 'error',
                signal: deadline.signal,
                body: JSON.stringify({
                  model: command.requestedModel,
                  messages: [{ role: 'user', content: command.prompt }],
                  max_tokens: command.limits.maxTokens,
                  stream: false,
                  provider: {
                    allow_fallbacks: false,
                    require_parameters: true,
                    data_collection: 'deny',
                    zdr: true,
                  },
                }),
              });
            } catch {
              throw interruptedError(deadline, options.signal, reservationId);
            }
            const latencyMs = Math.max(0, Math.ceil(now() - dispatchStartedAt));
            if (!completionResponse.ok) {
              const error = httpError(completionResponse, now);
              await rollbackKnownNoCharge(
                dependencies.ledger,
                reservationId,
                `OPENROUTER_HTTP_${completionResponse.status}`,
              );
              throw error;
            }

            let completion;
            try {
              const completionBody = await readBoundedJson(
                completionResponse,
                COMPLETION_BODY_LIMIT_BYTES,
                'MALFORMED_COMPLETION',
              );
              completion = parseCompletion(completionBody);
            } catch (error) {
              if (deadline.signal.aborted) {
                throw interruptedError(deadline, options.signal, reservationId);
              }
              if (error instanceof OpenRouterAdapterError) {
                throw withCommittedReservation(error, reservationId);
              }
              throw new OpenRouterAdapterError(
                'MALFORMED_COMPLETION',
                'OpenRouter returned an invalid completion.',
                { reconciliationRequired: true, reservationId },
              );
            }

            const generationMetadata = await fetchGenerationMetadata(
              dependencies,
              credential,
              completion.generationId,
              deadline.signal,
            );
            const metadataIsConsistent =
              generationMetadata !== undefined &&
              generationMetadata.model === completion.actualModel;
            const actualCostMicrodollars = metadataIsConsistent
              ? generationMetadata.costMicrodollars
              : completion.costMicrodollars;
            const provider = metadataIsConsistent ? generationMetadata.provider : undefined;
            const record: OpenRouterAuditionRecord = {
              requestId: command.requestId,
              mode: 'RAW_MODEL_AUDITION',
              requestedModel: command.requestedModel,
              actualModel: completion.actualModel,
              generationId: completion.generationId,
              tokenUsage: completion.tokenUsage,
              latencyMs,
              catalogSnapshot: catalog.snapshot,
              actualCostMicrodollars,
              generationMetadataStatus: metadataIsConsistent ? 'VERIFIED' : 'UNAVAILABLE',
              ...(provider === undefined ? {} : { provider }),
            };

            try {
              await dependencies.ledger.settle(reservationId, actualCostMicrodollars);
            } catch {
              throw new OpenRouterAdapterError(
                'SETTLEMENT_FAILED',
                'The OpenRouter cost reservation could not be settled.',
                { reconciliationRequired: true, reservationId, record },
              );
            }
            if (completion.actualModel !== command.requestedModel) {
              throw new OpenRouterAdapterError(
                'MODEL_MISMATCH',
                'OpenRouter returned a model other than the exact requested model.',
                { record },
              );
            }
            if (actualCostMicrodollars > command.limits.maxCostMicrodollars) {
              throw new OpenRouterAdapterError(
                'COST_CAP_EXCEEDED',
                'OpenRouter reported a cost above the approved cap.',
                { record },
              );
            }

            return { outputText: completion.outputText, record };
          },
        );
      } catch (error) {
        if (error instanceof OpenRouterAdapterError) throw error;
        throw new OpenRouterAdapterError(
          credentialCallbackEntered ? 'INTERNAL_FAILURE' : 'CREDENTIAL_UNAVAILABLE',
          credentialCallbackEntered
            ? 'The OpenRouter audition failed safely.'
            : 'The configured OpenRouter credential is unavailable.',
        );
      } finally {
        deadline.cleanup();
      }
    },
  };
}
