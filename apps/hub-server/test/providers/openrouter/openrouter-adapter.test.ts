import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenRouterAdapterError,
  createOpenRouterAdapter,
  type AtomicReservationLedger,
  type OpenRouterAdapterDependencies,
  type OpenRouterRawAuditionCommand,
} from '../../../dist/providers/openrouter/index.js';

const TEST_SECRET = 'test-secret-that-must-never-escape';

function validCommand(): OpenRouterRawAuditionCommand {
  return {
    schemaVersion: 1,
    requestId: 'audition-001',
    mode: 'RAW_MODEL_AUDITION',
    requestedModel: 'example/model-v1',
    toolProfileId: 'no-tools@1',
    credentialRef: 'windows-credential:openrouter-inference',
    prompt: 'Return a concise answer for the bounded fixture.',
    limits: {
      maxCostMicrodollars: 100_000,
      maxTokens: 256,
      maxDurationMs: 2_000,
    },
  };
}

function validCatalog() {
  return {
    data: [
      {
        id: 'example/model-v1',
        canonical_slug: 'example/model-v1',
        context_length: 16_384,
        created: 1_787_990_400,
        pricing: {
          prompt: '0.000001',
          completion: '0.000002',
          request: '0',
        },
        supported_parameters: ['max_tokens', 'temperature'],
        top_provider: {
          context_length: 16_384,
          max_completion_tokens: 4_096,
          is_moderated: true,
        },
      },
    ],
  };
}

function validCompletion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-audition-001',
    model: 'example/model-v1',
    object: 'chat.completion',
    created: 1_787_990_401,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'A bounded answer.',
        },
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
      cost: 0.001234,
    },
    ...overrides,
  };
}

function validGeneration(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'gen-audition-001',
      model: 'example/model-v1',
      provider_name: 'Safe Provider',
      tokens_prompt: 12,
      tokens_completion: 4,
      total_cost: 0.001234,
      ...overrides,
    },
  };
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

type FetchStep = Response | ((url: string, init: RequestInit | undefined) => Promise<Response>);

class ScriptedFetch {
  readonly calls: FetchCall[] = [];
  private readonly steps: FetchStep[];

  constructor(steps: FetchStep[]) {
    this.steps = [...steps];
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    this.calls.push({ url, init });
    const next = this.steps.shift();
    assert.ok(next, `unexpected fetch to ${url}`);
    return next instanceof Response ? next : next(url, init);
  };
}

class RecordingLedger implements AtomicReservationLedger {
  readonly events: string[] = [];
  readonly reservations: Array<{
    requestId: string;
    amountMicrodollars: number;
    estimatedCostMicrodollars: number;
    catalogSnapshotSha256: string;
  }> = [];
  readonly settled: Array<{ reservationId: string; actualCostMicrodollars: number }> = [];
  readonly rolledBack: Array<{ reservationId: string; reason: string }> = [];
  failCommit = false;
  failRollback = false;
  failSettle = false;

  async reserve(input: {
    requestId: string;
    amountMicrodollars: number;
    estimatedCostMicrodollars: number;
    catalogSnapshotSha256: string;
  }): Promise<{ reservationId: string }> {
    this.events.push('reserve');
    this.reservations.push(input);
    return { reservationId: `reservation-${this.reservations.length}` };
  }

  async commit(reservationId: string): Promise<void> {
    this.events.push(`commit:${reservationId}`);
    if (this.failCommit) throw new Error('commit failed');
  }

  async rollback(reservationId: string, reason: string): Promise<void> {
    this.events.push(`rollback:${reservationId}`);
    if (this.failRollback) throw new Error('rollback failed');
    this.rolledBack.push({ reservationId, reason });
  }

  async settle(reservationId: string, actualCostMicrodollars: number): Promise<void> {
    this.events.push(`settle:${reservationId}`);
    if (this.failSettle) throw new Error('settle failed');
    this.settled.push({ reservationId, actualCostMicrodollars });
  }
}

function makeHarness(
  steps: FetchStep[] = [
    jsonResponse(validCatalog()),
    jsonResponse(validCompletion()),
    jsonResponse(validGeneration()),
  ],
  dependencyOverrides: Partial<OpenRouterAdapterDependencies> = {},
) {
  const scriptedFetch = new ScriptedFetch(steps);
  const ledger = new RecordingLedger();
  let credentialUseCount = 0;
  const dependencies: OpenRouterAdapterDependencies = {
    fetch: scriptedFetch.fetch,
    ledger,
    credentialResolver: {
      async withCredential(_credentialRef, use) {
        credentialUseCount += 1;
        return use(TEST_SECRET);
      },
    },
    now: (() => {
      let current = Date.parse('2026-08-30T16:00:00.000Z');
      return () => (current += 25);
    })(),
    ...dependencyOverrides,
  };

  return {
    adapter: createOpenRouterAdapter(dependencies),
    scriptedFetch,
    ledger,
    get credentialUseCount() {
      return credentialUseCount;
    },
  };
}

function assertAdapterError(error: unknown, code: string): asserts error is OpenRouterAdapterError {
  assert.ok(error instanceof OpenRouterAdapterError);
  assert.equal(error.code, code);
  assert.ok(!error.message.includes(TEST_SECRET));
  assert.ok(!JSON.stringify(error).includes(TEST_SECRET));
}

test('audition refreshes and validates the catalog before reserving or dispatching', async () => {
  const order: string[] = [];
  const scriptedFetch = new ScriptedFetch([
    async () => {
      order.push('catalog');
      return jsonResponse(validCatalog());
    },
    async () => {
      order.push('completion');
      return jsonResponse(validCompletion());
    },
    async () => {
      order.push('generation');
      return jsonResponse(validGeneration());
    },
  ]);
  const ledger = new RecordingLedger();
  const adapter = createOpenRouterAdapter({
    fetch: scriptedFetch.fetch,
    ledger: {
      ...ledger,
      reserve: async (input) => {
        order.push('reserve');
        return ledger.reserve(input);
      },
      commit: async (reservationId) => {
        order.push('commit');
        return ledger.commit(reservationId);
      },
      rollback: ledger.rollback.bind(ledger),
      settle: async (reservationId, amount) => {
        order.push('settle');
        return ledger.settle(reservationId, amount);
      },
    },
    credentialResolver: {
      withCredential: async (_ref, use) => use(TEST_SECRET),
    },
    now: () => Date.parse('2026-08-30T16:00:00.000Z'),
  });

  const result = await adapter.audition(validCommand());

  assert.deepEqual(order, ['catalog', 'reserve', 'commit', 'completion', 'generation', 'settle']);
  assert.match(result.record.catalogSnapshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.record.catalogSnapshot.modelId, 'example/model-v1');
  assert.equal(result.record.catalogSnapshot.capturedAt, '2026-08-30T16:00:00.000Z');
});

test('dispatches only to fixed official endpoints with exact-model privacy controls and no tools', async () => {
  const harness = makeHarness();

  await harness.adapter.audition(validCommand());

  assert.deepEqual(
    harness.scriptedFetch.calls.map((call) => call.url),
    [
      'https://openrouter.ai/api/v1/models',
      'https://openrouter.ai/api/v1/chat/completions',
      'https://openrouter.ai/api/v1/generation?id=gen-audition-001',
    ],
  );
  const completionCall = harness.scriptedFetch.calls[1];
  assert.ok(completionCall);
  const body = JSON.parse(String(completionCall.init?.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    model: 'example/model-v1',
    messages: [{ role: 'user', content: validCommand().prompt }],
    max_tokens: 256,
    stream: false,
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: 'deny',
      zdr: true,
    },
  });
  assert.ok(!('tools' in body));
  assert.equal(
    new Headers(completionCall.init?.headers).get('authorization'),
    `Bearer ${TEST_SECRET}`,
  );
});

test('returns a prompt-free accounting record and settles integer microdollars', async () => {
  const harness = makeHarness();

  const result = await harness.adapter.audition(validCommand());

  assert.equal(result.outputText, 'A bounded answer.');
  assert.deepEqual(result.record.tokenUsage, {
    promptTokens: 12,
    completionTokens: 4,
    totalTokens: 16,
  });
  assert.equal(result.record.requestedModel, 'example/model-v1');
  assert.equal(result.record.actualModel, 'example/model-v1');
  assert.equal(result.record.provider, 'Safe Provider');
  assert.equal(result.record.generationId, 'gen-audition-001');
  assert.equal(result.record.actualCostMicrodollars, 1_234);
  assert.ok(Number.isSafeInteger(result.record.latencyMs));
  assert.deepEqual(harness.ledger.settled, [
    { reservationId: 'reservation-1', actualCostMicrodollars: 1_234 },
  ]);
  assert.ok(!JSON.stringify(result.record).includes(validCommand().prompt));
  assert.ok(!JSON.stringify(result).includes(TEST_SECRET));
});

test('reserves the caller cap atomically after a conservative catalog price estimate', async () => {
  const harness = makeHarness();

  await harness.adapter.audition(validCommand());

  assert.equal(harness.ledger.reservations.length, 1);
  assert.equal(harness.ledger.reservations[0]?.amountMicrodollars, 100_000);
  assert.ok((harness.ledger.reservations[0]?.estimatedCostMicrodollars ?? 0) > 0);
  assert.match(harness.ledger.reservations[0]?.catalogSnapshotSha256 ?? '', /^[a-f0-9]{64}$/);
});

test('rejects non-v1, non-raw, tool-bearing, and arbitrary input before resolving a credential', async (t) => {
  for (const [name, command] of [
    ['schema version', { ...validCommand(), schemaVersion: 2 }],
    ['mode', { ...validCommand(), mode: 'SANDBOX_AGENT_AUDITION' }],
    ['tool profile', { ...validCommand(), toolProfileId: 'sandbox-tools@1' }],
    ['tools field', { ...validCommand(), tools: [] }],
    ['origin override', { ...validCommand(), apiOrigin: 'https://evil.example' }],
  ] as const) {
    await t.test(name, async () => {
      const harness = makeHarness();

      await assert.rejects(
        harness.adapter.audition(command as OpenRouterRawAuditionCommand),
        (error) => {
          assertAdapterError(error, 'INVALID_REQUEST');
          return true;
        },
      );
      assert.equal(harness.credentialUseCount, 0);
      assert.equal(harness.scriptedFetch.calls.length, 0);
      assert.equal(harness.ledger.reservations.length, 0);
    });
  }
});

test('rejects a missing or malformed requested model in the fresh catalog before reserving', async (t) => {
  await t.test('model is missing', async () => {
    const harness = makeHarness([jsonResponse({ data: [] })]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'MODEL_NOT_AVAILABLE');
      return true;
    });
    assert.equal(harness.ledger.reservations.length, 0);
  });

  await t.test('model pricing is malformed', async () => {
    const catalog = validCatalog();
    catalog.data[0]!.pricing.completion = 'not-a-price';
    const harness = makeHarness([jsonResponse(catalog)]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'MALFORMED_CATALOG');
      return true;
    });
    assert.equal(harness.ledger.reservations.length, 0);
  });

  await t.test('model does not support max_tokens', async () => {
    const catalog = validCatalog();
    catalog.data[0]!.supported_parameters = ['temperature'];
    const harness = makeHarness([jsonResponse(catalog)]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'MODEL_PARAMETERS_UNSUPPORTED');
      return true;
    });
    assert.equal(harness.ledger.reservations.length, 0);
  });
});

test('rejects a conservative estimate over the cap before reservation or paid dispatch', async () => {
  const command = validCommand();
  command.limits.maxCostMicrodollars = 1;
  const harness = makeHarness([jsonResponse(validCatalog())]);

  await assert.rejects(harness.adapter.audition(command), (error) => {
    assertAdapterError(error, 'COST_CAP_TOO_LOW');
    return true;
  });
  assert.equal(harness.ledger.reservations.length, 0);
  assert.equal(harness.scriptedFetch.calls.length, 1);
});

test('maps 402 and 429 safely and rolls back a reservation after a definitive rejection', async (t) => {
  for (const [status, code] of [
    [402, 'INSUFFICIENT_CREDITS'],
    [429, 'RATE_LIMITED'],
  ] as const) {
    await t.test(String(status), async () => {
      const harness = makeHarness([
        jsonResponse(validCatalog()),
        jsonResponse({ error: { message: TEST_SECRET } }, status, { 'retry-after': '2' }),
      ]);

      await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
        assertAdapterError(error, code);
        if (code === 'RATE_LIMITED') {
          assert.equal(error.retryAfterMs, 2_000);
        }
        return true;
      });
      assert.deepEqual(harness.ledger.rolledBack, [
        { reservationId: 'reservation-1', reason: `OPENROUTER_HTTP_${status}` },
      ]);
      assert.equal(harness.ledger.settled.length, 0);
    });
  }
});

test('maps OpenRouter HTTP timeout status to TIMEOUT and releases the known-unbilled hold', async () => {
  const harness = makeHarness([
    jsonResponse(validCatalog()),
    jsonResponse({ error: { message: TEST_SECRET } }, 524),
  ]);

  await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
    assertAdapterError(error, 'TIMEOUT');
    assert.equal(error.reconciliationRequired, false);
    return true;
  });
  assert.deepEqual(harness.ledger.rolledBack, [
    { reservationId: 'reservation-1', reason: 'OPENROUTER_HTTP_524' },
  ]);
});

test('keeps a committed hold when the paid dispatch ends in an ambiguous network failure', async () => {
  const harness = makeHarness([
    jsonResponse(validCatalog()),
    async () => {
      throw new TypeError(`network failure: ${TEST_SECRET}`);
    },
  ]);

  await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
    assertAdapterError(error, 'NETWORK_ERROR');
    assert.equal(error.reconciliationRequired, true);
    assert.equal(error.reservationId, 'reservation-1');
    return true;
  });
  assert.equal(harness.ledger.rolledBack.length, 0);
  assert.equal(harness.ledger.settled.length, 0);
});

test('rolls back a hold when ledger commit fails before any paid dispatch', async () => {
  const harness = makeHarness();
  harness.ledger.failCommit = true;

  await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
    assertAdapterError(error, 'RESERVATION_FAILED');
    return true;
  });
  assert.deepEqual(harness.ledger.rolledBack, [
    { reservationId: 'reservation-1', reason: 'COMMIT_FAILED_BEFORE_DISPATCH' },
  ]);
  assert.equal(harness.scriptedFetch.calls.length, 1);
});

test('surfaces settlement failure with a safe reconciliation record and never rolls back', async () => {
  const harness = makeHarness();
  harness.ledger.failSettle = true;

  await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
    assertAdapterError(error, 'SETTLEMENT_FAILED');
    assert.equal(error.reconciliationRequired, true);
    assert.equal(error.reservationId, 'reservation-1');
    assert.equal(error.record?.actualCostMicrodollars, 1_234);
    assert.ok(!JSON.stringify(error.record).includes(validCommand().prompt));
    return true;
  });
  assert.equal(harness.ledger.rolledBack.length, 0);
});

test('cancels before credential use and keeps a committed hold for ambiguous in-flight cancellation', async (t) => {
  await t.test('already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeHarness();

    await assert.rejects(
      harness.adapter.audition(validCommand(), { signal: controller.signal }),
      (error) => {
        assertAdapterError(error, 'CANCELLED');
        return true;
      },
    );
    assert.equal(harness.credentialUseCount, 0);
    assert.equal(harness.ledger.reservations.length, 0);
  });

  await t.test('cancelled during paid dispatch', async () => {
    const controller = new AbortController();
    const harness = makeHarness([
      jsonResponse(validCatalog()),
      async (_url, init) => {
        controller.abort();
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            {
              once: true,
            },
          );
          if (init?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
        });
        throw new Error('unreachable');
      },
    ]);

    await assert.rejects(
      harness.adapter.audition(validCommand(), { signal: controller.signal }),
      (error) => {
        assertAdapterError(error, 'CANCELLED');
        assert.equal(error.reconciliationRequired, true);
        assert.equal(error.reservationId, 'reservation-1');
        return true;
      },
    );
    assert.equal(harness.ledger.rolledBack.length, 0);
    assert.equal(harness.ledger.settled.length, 0);
  });
});

test('times out an in-flight completion without unsafe rollback', async () => {
  const command = validCommand();
  command.limits.maxDurationMs = 20;
  const harness = makeHarness([
    jsonResponse(validCatalog()),
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          {
            once: true,
          },
        );
      }),
  ]);

  await assert.rejects(harness.adapter.audition(command), (error) => {
    assertAdapterError(error, 'TIMEOUT');
    assert.equal(error.reconciliationRequired, true);
    assert.equal(error.reservationId, 'reservation-1');
    return true;
  });
  assert.equal(harness.ledger.rolledBack.length, 0);
});

test('times out while reading a catalog body before creating a reservation', async () => {
  const command = validCommand();
  command.limits.maxDurationMs = 20;
  const harness = makeHarness([
    async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) abort();
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    },
  ]);

  await assert.rejects(harness.adapter.audition(command), (error) => {
    assertAdapterError(error, 'TIMEOUT');
    assert.equal(error.reconciliationRequired, false);
    return true;
  });
  assert.equal(harness.ledger.reservations.length, 0);
});

test('rejects oversized and malformed provider bodies without parsing unbounded data', async (t) => {
  await t.test('oversized catalog', async () => {
    const harness = makeHarness([
      new Response('x'.repeat(8 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'application/json' },
      }),
    ]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'RESPONSE_TOO_LARGE');
      return true;
    });
    assert.equal(harness.ledger.reservations.length, 0);
  });

  await t.test('malformed completion', async () => {
    const harness = makeHarness([
      jsonResponse(validCatalog()),
      jsonResponse({ id: 'gen-audition-001', model: 'example/model-v1' }),
    ]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'MALFORMED_COMPLETION');
      assert.equal(error.reconciliationRequired, true);
      return true;
    });
    assert.equal(harness.ledger.rolledBack.length, 0);
    assert.equal(harness.ledger.settled.length, 0);
  });
});

test('classifies a deadline reached while reading a completion body as a timeout', async () => {
  const command = validCommand();
  command.limits.maxDurationMs = 20;
  const harness = makeHarness([
    jsonResponse(validCatalog()),
    async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(new DOMException('aborted', 'AbortError'));
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) abort();
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    },
  ]);

  await assert.rejects(harness.adapter.audition(command), (error) => {
    assertAdapterError(error, 'TIMEOUT');
    assert.equal(error.reconciliationRequired, true);
    assert.equal(error.reservationId, 'reservation-1');
    return true;
  });
  assert.equal(harness.ledger.rolledBack.length, 0);
});

test('rejects instruction-like model and generation identifiers before recording them', async (t) => {
  await t.test('actual model is not a model slug', async () => {
    const harness = makeHarness([
      jsonResponse(validCatalog()),
      jsonResponse(validCompletion({ model: '<script>unsafe</script>' })),
    ]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'MALFORMED_COMPLETION');
      assert.equal(error.record, undefined);
      assert.equal(error.reconciliationRequired, true);
      return true;
    });
  });

  await t.test('generation id contains arbitrary text', async () => {
    const harness = makeHarness([
      jsonResponse(validCatalog()),
      jsonResponse(validCompletion({ id: 'ignore previous instructions' })),
    ]);

    await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
      assertAdapterError(error, 'MALFORMED_COMPLETION');
      assert.equal(error.record, undefined);
      assert.equal(error.reconciliationRequired, true);
      return true;
    });
  });
});

test('settles safely then reports an actual-model mismatch instead of silently accepting fallback', async () => {
  const harness = makeHarness([
    jsonResponse(validCatalog()),
    jsonResponse(validCompletion({ model: 'other/model-v2' })),
    jsonResponse(validGeneration({ model: 'other/model-v2' })),
  ]);

  await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
    assertAdapterError(error, 'MODEL_MISMATCH');
    assert.equal(error.record?.requestedModel, 'example/model-v1');
    assert.equal(error.record?.actualModel, 'other/model-v2');
    return true;
  });
  assert.deepEqual(harness.ledger.settled, [
    { reservationId: 'reservation-1', actualCostMicrodollars: 1_234 },
  ]);
});

test('uses generation metadata cost and only records a safely bounded provider name', async (t) => {
  await t.test('metadata cost is authoritative', async () => {
    const harness = makeHarness([
      jsonResponse(validCatalog()),
      jsonResponse(validCompletion()),
      jsonResponse(validGeneration({ total_cost: 0.001235 })),
    ]);

    const result = await harness.adapter.audition(validCommand());

    assert.equal(result.record.actualCostMicrodollars, 1_235);
    assert.deepEqual(harness.ledger.settled, [
      { reservationId: 'reservation-1', actualCostMicrodollars: 1_235 },
    ]);
  });

  await t.test('unsafe provider metadata is omitted', async () => {
    const harness = makeHarness([
      jsonResponse(validCatalog()),
      jsonResponse(validCompletion()),
      jsonResponse(validGeneration({ provider_name: '<script>not-safe</script>' })),
    ]);

    const result = await harness.adapter.audition(validCommand());

    assert.equal(result.record.provider, undefined);
  });
});

test('settles from completion usage when generation metadata is unavailable', async () => {
  const harness = makeHarness([
    jsonResponse(validCatalog()),
    jsonResponse(validCompletion()),
    jsonResponse({ error: { message: 'not ready' } }, 404),
  ]);

  const result = await harness.adapter.audition(validCommand());

  assert.equal(result.record.generationMetadataStatus, 'UNAVAILABLE');
  assert.equal(result.record.provider, undefined);
  assert.deepEqual(harness.ledger.settled, [
    { reservationId: 'reservation-1', actualCostMicrodollars: 1_234 },
  ]);
});

test('sanitizes credential failures and never reserves or fetches', async () => {
  const harness = makeHarness([], {
    credentialResolver: {
      async withCredential() {
        throw new Error(`credential failed: ${TEST_SECRET}`);
      },
    },
  });

  await assert.rejects(harness.adapter.audition(validCommand()), (error) => {
    assertAdapterError(error, 'CREDENTIAL_UNAVAILABLE');
    return true;
  });
  assert.equal(harness.ledger.reservations.length, 0);
  assert.equal(harness.scriptedFetch.calls.length, 0);
});

test('does not roll back a settled reservation when a post-settlement policy error is raised', async () => {
  const command = validCommand();
  command.limits.maxCostMicrodollars = 1_000;
  const freeLookingCatalog = validCatalog();
  freeLookingCatalog.data[0]!.pricing.prompt = '0';
  freeLookingCatalog.data[0]!.pricing.completion = '0';
  const harness = makeHarness([
    jsonResponse(freeLookingCatalog),
    jsonResponse(validCompletion()),
    jsonResponse(validGeneration()),
  ]);

  await assert.rejects(harness.adapter.audition(command), (error) => {
    assertAdapterError(error, 'COST_CAP_EXCEEDED');
    assert.equal(error.record?.actualCostMicrodollars, 1_234);
    return true;
  });
  assert.equal(harness.ledger.rolledBack.length, 0);
  assert.deepEqual(harness.ledger.settled, [
    { reservationId: 'reservation-1', actualCostMicrodollars: 1_234 },
  ]);
});
