import { describe, expect, it, vi } from 'vitest';

import { HubApiError, requestDelegationPreview } from './api';

const RESPONSE_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const HOST_BUDGET_CEILING_MICRODOLLARS = 400_000;
const DEFAULT_OBJECTIVE = 'Build and verify the bounded tablet hub.';

function validPreview(
  objective = DEFAULT_OBJECTIVE,
  maxCostMicrodollars = HOST_BUDGET_CEILING_MICRODOLLARS,
) {
  const workItems = ['research', 'implementation', 'verification', 'review'].map((id) => ({
    id,
    title: id[0]!.toUpperCase() + id.slice(1),
  }));
  const agents = ['hermes@0.20.5', 'codex@0.150.1', 'codex@0.150.1', 'claude-code@2.1.251'];

  return {
    mode: 'PREVIEW_ONLY',
    intent: {
      objective,
      budget: {
        maxCostMicrodollars,
        maxTokens: 40_000,
        maxDurationMs: 400_000,
      },
    },
    plan: { workItems },
    assignments: workItems.map((item, index) => ({
      workItemId: item.id,
      candidate: {
        agentProfileId: agents[index],
        modelProfileId: `model.fixture-${index}@1.0.0`,
        toolProfileId: 'tool.read-only@1.0.0',
      },
      selectionReasons: ['Capability match', 'Current evidence', 'Within budget'],
      expectedCostMicrodollars: 25_000,
      confidence: 0.9,
      requiredApprovals: ['approval.local-review'],
    })),
    estimatedTotalCostMicrodollars: 100_000,
    sideEffects: [],
  };
}

describe('hub delegation preview client', () => {
  it('posts only the bounded public request and returns a validated display summary', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(validPreview()), { status: 200, headers: RESPONSE_HEADERS }),
      );

    const preview = await requestDelegationPreview(
      {
        objective: '  Build and verify the bounded tablet hub.  ',
        workspace: 'monster-agent-hub',
        budgetCapMicrodollars: HOST_BUDGET_CEILING_MICRODOLLARS,
      },
      undefined,
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/delegation/preview',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({
          objective: 'Build and verify the bounded tablet hub.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: HOST_BUDGET_CEILING_MICRODOLLARS,
        }),
      }),
    );
    expect(preview).toMatchObject({
      objective: 'Build and verify the bounded tablet hub.',
      estimatedTotalCostMicrodollars: 100_000,
    });
    expect(preview.workItems).toHaveLength(4);
    expect(preview.assignments.map((assignment) => assignment.agentProfileId)).toEqual([
      'hermes@0.20.5',
      'codex@0.150.1',
      'codex@0.150.1',
      'claude-code@2.1.251',
    ]);
    expect(Object.isFrozen(preview)).toBe(true);
  });

  it('rejects one microdollar above the host ceiling before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      requestDelegationPreview(
        {
          objective: 'Review the hub.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: HOST_BUDGET_CEILING_MICRODOLLARS + 1,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when a successful response carries side effects or inconsistent cost', async () => {
    const unsafe = {
      ...validPreview('Review the hub.', 250_000),
      sideEffects: ['started-agent'],
      estimatedTotalCostMicrodollars: 99_999,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(unsafe), { status: 200, headers: RESPONSE_HEADERS }),
      );

    await expect(
      requestDelegationPreview(
        {
          objective: 'Review the hub.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('returns a bounded server error without reflecting secret-shaped response fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'OBJECTIVE_REJECTED',
            message: 'This objective requires a narrower review-only request.',
            token: 'must-not-escape',
          },
        }),
        { status: 400, headers: RESPONSE_HEADERS },
      ),
    );

    const request = requestDelegationPreview(
      {
        objective: 'Run an unsafe request.',
        workspace: 'monster-agent-hub',
        budgetCapMicrodollars: 250_000,
      },
      undefined,
      fetcher,
    );

    await expect(request).rejects.toEqual(
      new HubApiError(
        'OBJECTIVE_REJECTED',
        'This objective requires a narrower review-only request.',
      ),
    );
    await expect(request).rejects.not.toHaveProperty('token');
  });

  it('rejects unsupported workspaces before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      requestDelegationPreview(
        {
          objective: 'Review the hub.',
          workspace: '../other-project',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a successful response for a different normalized objective', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(validPreview('Review a different hub.', 250_000)), {
        status: 200,
        headers: RESPONSE_HEADERS,
      }),
    );

    await expect(
      requestDelegationPreview(
        {
          objective: '  Review the hub.  ',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a successful response for a different intent budget ceiling', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(validPreview('Review the hub.', 250_001)), {
        status: 200,
        headers: RESPONSE_HEADERS,
      }),
    );

    await expect(
      requestDelegationPreview(
        {
          objective: 'Review the hub.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects malformed UTF-8 even when replacement decoding would produce valid JSON', async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(validPreview()));
    const markerIndex = JSON.stringify(validPreview()).indexOf('Capability match');
    expect(markerIndex).toBeGreaterThan(-1);
    encoded[markerIndex] = 0xff;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        }),
        { status: 200, headers: RESPONSE_HEADERS },
      ),
    );

    await expect(
      requestDelegationPreview(
        {
          objective: DEFAULT_OBJECTIVE,
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: HOST_BUDGET_CEILING_MICRODOLLARS,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a declared response body above the public size bound', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {
          ...RESPONSE_HEADERS,
          'content-length': String(256 * 1024 + 1),
        },
      }),
    );

    await expect(
      requestDelegationPreview(
        {
          objective: 'Review the bounded response.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('cancels an in-flight request when its caller aborts', async () => {
    const callerController = new AbortController();
    const capture: { requestSignal?: AbortSignal } = {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) {
        return Promise.reject(new Error('expected a request signal'));
      }
      capture.requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('The request was aborted.', 'AbortError')),
          { once: true },
        );
      });
    });

    const outcome = requestDelegationPreview(
      {
        objective: 'Cancel this preview.',
        workspace: 'monster-agent-hub',
        budgetCapMicrodollars: 250_000,
      },
      { signal: callerController.signal },
      fetcher,
    ).catch((error: unknown) => error);

    callerController.abort();
    const result = await outcome;
    expect(capture.requestSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ code: 'REQUEST_CANCELLED' });
  });

  it('rejects a pre-aborted caller without making a request', async () => {
    const callerController = new AbortController();
    callerController.abort();
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      requestDelegationPreview(
        {
          objective: 'Do not start this preview.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        { signal: callerController.signal },
        fetcher,
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a late successful response when the transport ignores caller cancellation', async () => {
    const callerController = new AbortController();
    const capture: {
      requestSignal?: AbortSignal;
      resolveResponse?: (response: Response) => void;
    } = {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (init?.signal !== undefined && init.signal !== null) {
        capture.requestSignal = init.signal;
      }
      return new Promise<Response>((resolve) => {
        capture.resolveResponse = resolve;
      });
    });

    const outcome = requestDelegationPreview(
      {
        objective: 'Reject this late preview.',
        workspace: 'monster-agent-hub',
        budgetCapMicrodollars: 250_000,
      },
      { signal: callerController.signal },
      fetcher,
    ).catch((error: unknown) => error);

    callerController.abort();
    capture.resolveResponse?.(
      new Response(JSON.stringify(validPreview('Reject this late preview.', 250_000)), {
        status: 200,
        headers: RESPONSE_HEADERS,
      }),
    );

    expect(capture.requestSignal?.aborted).toBe(true);
    await expect(outcome).resolves.toMatchObject({ code: 'REQUEST_CANCELLED' });
  });

  it('stops observing caller cancellation after a successful request settles', async () => {
    const callerController = new AbortController();
    const capture: { requestSignal?: AbortSignal } = {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (init?.signal !== undefined && init.signal !== null) {
        capture.requestSignal = init.signal;
      }
      return Promise.resolve(
        new Response(JSON.stringify(validPreview('Review listener cleanup.', 250_000)), {
          status: 200,
          headers: RESPONSE_HEADERS,
        }),
      );
    });

    await requestDelegationPreview(
      {
        objective: 'Review listener cleanup.',
        workspace: 'monster-agent-hub',
        budgetCapMicrodollars: 250_000,
      },
      { signal: callerController.signal },
      fetcher,
    );
    expect(capture.requestSignal?.aborted).toBe(false);

    callerController.abort();
    expect(capture.requestSignal?.aborted).toBe(false);
  });

  it('keeps the request deadline active while reading a stalled response body', async () => {
    vi.useFakeTimers();
    const capture: {
      requestSignal?: AbortSignal;
      bodyController?: ReadableStreamDefaultController<Uint8Array>;
    } = {};
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        if (init?.signal !== undefined && init.signal !== null) {
          capture.requestSignal = init.signal;
        }
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                capture.bodyController = controller;
              },
            }),
            { status: 200, headers: RESPONSE_HEADERS },
          ),
        );
      });
      const outcome = requestDelegationPreview(
        {
          objective: 'Review the hub response deadline.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_001);
      const didAbort = capture.requestSignal?.aborted;
      capture.bodyController?.enqueue(
        new TextEncoder().encode(
          JSON.stringify(validPreview('Review the hub response deadline.', 250_000)),
        ),
      );
      capture.bodyController?.close();
      const result = await outcome;
      expect(didAbort).toBe(true);
      expect(result).toMatchObject({ code: 'HOST_UNAVAILABLE' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a late successful response when the transport ignores the request deadline', async () => {
    vi.useFakeTimers();
    const capture: {
      requestSignal?: AbortSignal;
      resolveResponse?: (response: Response) => void;
    } = {};
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        if (init?.signal !== undefined && init.signal !== null) {
          capture.requestSignal = init.signal;
        }
        return new Promise<Response>((resolve) => {
          capture.resolveResponse = resolve;
        });
      });
      const outcome = requestDelegationPreview(
        {
          objective: 'Reject the late deadline response.',
          workspace: 'monster-agent-hub',
          budgetCapMicrodollars: 250_000,
        },
        undefined,
        fetcher,
      ).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_001);
      capture.resolveResponse?.(
        new Response(JSON.stringify(validPreview('Reject the late deadline response.', 250_000)), {
          status: 200,
          headers: RESPONSE_HEADERS,
        }),
      );

      expect(capture.requestSignal?.aborted).toBe(true);
      await expect(outcome).resolves.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    } finally {
      vi.useRealTimers();
    }
  });
});
