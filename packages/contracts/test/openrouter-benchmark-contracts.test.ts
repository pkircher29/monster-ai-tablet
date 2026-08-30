import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePromotionEligibility,
  parseBenchmarkRun,
  parseOpenRouterAuditionRequest,
  parseTrustedPromotionEvidence,
  parseTrustedPromotionUserApproval,
} from '../src/index.ts';

const TEST_BASE_MS = Date.now();
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function rawModelCandidate(index = 1) {
  return {
    agentProfileId: `openrouter-raw-runner-${index}@1`,
    modelProfileId: `openrouter/example/model-${index}@catalog-2026-08-30`,
    toolProfileId: 'no-tools@1',
  };
}

function agentHarnessCandidate(index = 1) {
  return {
    agentProfileId: `codex-windows-${index}@0.150.1`,
    modelProfileId: `openrouter/example/model-${index}@catalog-2026-08-30`,
    toolProfileId: 'sandbox-patch-test-only@1',
  };
}

function validAuditionRequest() {
  return {
    schemaVersion: 1,
    id: 'audition-example-model',
    requestedBy: 'paul',
    requestedAt: new Date(TEST_BASE_MS - MINUTE_MS).toISOString(),
    mode: 'RAW_MODEL_AUDITION',
    candidate: rawModelCandidate(),
    prompt: 'Solve the bounded fixture and return the requested structured result.',
    limits: {
      maxCostMicrodollars: 250_000,
      maxTokens: 16_000,
      maxDurationMs: 120_000,
    },
  };
}

function validBenchmarkRun() {
  return {
    schemaVersion: 1,
    id: 'benchmark-typescript-contracts',
    createdAt: new Date(TEST_BASE_MS - MINUTE_MS).toISOString(),
    benchmarkType: 'AGENT_HARNESS',
    fixtureId: 'typescript-contracts-v1',
    taskCategoryId: 'implementation',
    repetitions: 3,
    candidates: [agentHarnessCandidate(1), agentHarnessCandidate(2)],
    evidenceFields: [
      'FIXTURE_SHA256',
      'PROMPT_HASH',
      'ENVIRONMENT_HASH',
      'ARTIFACT_REFS',
      'POLICY_VIOLATIONS',
    ],
    outcomeFields: [
      'COMPLETION_STATUS',
      'QUALITY_SCORE',
      'COST_MICRODOLLARS',
      'TOKEN_USAGE',
      'LATENCY_MS',
      'CRITICAL_SAFETY_FAILURES',
    ],
  };
}

function validPromotionEvidence() {
  return {
    schemaVersion: 1,
    id: 'promotion-evidence-example-model',
    createdAt: new Date(TEST_BASE_MS - 5 * MINUTE_MS).toISOString(),
    candidate: agentHarnessCandidate(),
    taskCategoryId: 'implementation',
    benchmarkRunIds: ['benchmark-typescript-contracts'],
    distinctCaseCount: 10,
    minimumRepetitionsPerCase: 3,
    criticalSafetyFailureCount: 0,
    qualityGatePassed: true,
  };
}

function validPromotionApproval() {
  return {
    status: 'APPROVED',
    approvalId: 'approval-promote-example-model',
    evidenceId: 'promotion-evidence-example-model',
    candidate: agentHarnessCandidate(),
    taskCategoryId: 'implementation',
    approvedBy: 'paul',
    approvedAt: new Date(TEST_BASE_MS - MINUTE_MS).toISOString(),
  };
}

function evaluateTrustedPromotion(
  evidence = validPromotionEvidence(),
  approval:
    ReturnType<typeof validPromotionApproval> | { status: 'PENDING' } = validPromotionApproval(),
) {
  return evaluatePromotionEligibility({
    evidence: parseTrustedPromotionEvidence(evidence),
    userApproval: parseTrustedPromotionUserApproval(approval),
  });
}

test('OpenRouter audition preserves separate agent, model, and tool profile IDs', () => {
  const parsed = parseOpenRouterAuditionRequest(validAuditionRequest());

  assert.equal(parsed.candidate.agentProfileId, 'openrouter-raw-runner-1@1');
  assert.equal(parsed.candidate.modelProfileId, 'openrouter/example/model-1@catalog-2026-08-30');
  assert.equal(parsed.candidate.toolProfileId, 'no-tools@1');
});

test('OpenRouter audition accepts the two bounded v1 modes', async (t) => {
  await t.test('raw-model audition has an explicit no-tools profile', () => {
    const parsed = parseOpenRouterAuditionRequest(validAuditionRequest());

    assert.equal(parsed.mode, 'RAW_MODEL_AUDITION');
    assert.equal(parsed.candidate.toolProfileId, 'no-tools@1');
  });

  await t.test('sandbox-agent audition keeps its bounded tool profile', () => {
    const input = {
      ...validAuditionRequest(),
      mode: 'SANDBOX_AGENT_AUDITION',
      candidate: agentHarnessCandidate(),
    };

    const parsed = parseOpenRouterAuditionRequest(input);

    assert.equal(parsed.mode, 'SANDBOX_AGENT_AUDITION');
    assert.equal(parsed.candidate.toolProfileId, 'sandbox-patch-test-only@1');
  });
});

test('raw-model audition rejects a tool-bearing profile', () => {
  const input = validAuditionRequest();
  input.candidate.toolProfileId = 'sandbox-patch-test-only@1';

  assert.throws(() => parseOpenRouterAuditionRequest(input));
});

test('OpenRouter audition rejects caller-controlled provider origins', async (t) => {
  for (const unsafeOrigin of [
    'https://openrouter.ai',
    'http://openrouter.ai',
    'https://example.com',
    'https://openrouter.ai.evil.example',
    'https://user:password@openrouter.ai',
    'https://openrouter.ai/api/v1',
    'https://openrouter.ai?redirect=https://example.com',
    'https://openrouter.ai/#fragment',
  ]) {
    await t.test(`rejects ${unsafeOrigin}`, () => {
      const input = { ...validAuditionRequest(), apiOrigin: unsafeOrigin };

      assert.throws(() => parseOpenRouterAuditionRequest(input));
    });
  }
});

test('OpenRouter audition rejects caller-controlled credentials and base URLs', async (t) => {
  await t.test('baseUrl is not a recognized override', () => {
    const input = {
      ...validAuditionRequest(),
      baseUrl: 'https://alternate-provider.example/v1',
    };

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });

  await t.test('apiKey is not accepted in the request payload', () => {
    const input = {
      ...validAuditionRequest(),
      apiKey: 'literal-value-must-not-be-accepted',
    };

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });

  await t.test('credentialRef is not accepted even when it is only an alias', () => {
    const input = {
      ...validAuditionRequest(),
      credentialRef: 'windows-credential:openrouter-inference',
    };

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });
});

test('OpenRouter audition rejects stale and future-dated requests', async (t) => {
  await t.test('stale request', () => {
    const input = validAuditionRequest();
    input.requestedAt = new Date(TEST_BASE_MS - 6 * MINUTE_MS).toISOString();

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });

  await t.test('far-future request', () => {
    const input = validAuditionRequest();
    input.requestedAt = '9999-01-01T00:00:00.000Z';

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });
});

test('OpenRouter audition uses integer microdollars for an overflow-safe cost cap', async (t) => {
  for (const invalidCost of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await t.test(`rejects ${String(invalidCost)}`, () => {
      const input = validAuditionRequest();
      input.limits.maxCostMicrodollars = invalidCost;

      assert.throws(() => parseOpenRouterAuditionRequest(input));
    });
  }

  await t.test('rejects a per-request cost above the practical policy ceiling', () => {
    const input = validAuditionRequest();
    input.limits.maxCostMicrodollars = 10_000_001;

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });
});

test('OpenRouter audition enforces bounded token and duration caps', async (t) => {
  for (const [field, invalidValue] of [
    ['maxTokens', 0],
    ['maxTokens', 1_000_001],
    ['maxTokens', Number.NaN],
    ['maxDurationMs', 0],
    ['maxDurationMs', 600_001],
    ['maxDurationMs', Number.POSITIVE_INFINITY],
  ] as const) {
    await t.test(`rejects ${field}=${String(invalidValue)}`, () => {
      const input = validAuditionRequest();
      input.limits[field] = invalidValue;

      assert.throws(() => parseOpenRouterAuditionRequest(input));
    });
  }
});

test('OpenRouter audition rejects unknown fields and oversized prompts', async (t) => {
  await t.test('unknown nested limit fields are invalid', () => {
    const input = validAuditionRequest() as ReturnType<typeof validAuditionRequest> & {
      limits: ReturnType<typeof validAuditionRequest>['limits'] & { dailyCap: number };
    };
    input.limits.dailyCap = 1;

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });

  await t.test('prompts longer than 32768 characters are invalid', () => {
    const input = validAuditionRequest();
    input.prompt = 'x'.repeat(32_769);

    assert.throws(() => parseOpenRouterAuditionRequest(input));
  });
});

for (const benchmarkType of ['RAW_MODEL', 'AGENT_HARNESS', 'FULL_WORKFLOW'] as const) {
  test(`benchmark run distinguishes the ${benchmarkType} result set`, () => {
    const input = validBenchmarkRun();
    input.benchmarkType = benchmarkType;
    if (benchmarkType === 'RAW_MODEL') {
      input.candidates = [rawModelCandidate()];
    }

    const parsed = parseBenchmarkRun(input);

    assert.equal(parsed.benchmarkType, benchmarkType);
  });
}

test('benchmark run preserves fixture and task-category IDs', () => {
  const parsed = parseBenchmarkRun(validBenchmarkRun());

  assert.equal(parsed.fixtureId, 'typescript-contracts-v1');
  assert.equal(parsed.taskCategoryId, 'implementation');
});

test('benchmark run repetitions are bounded from one through three', async (t) => {
  for (const acceptedRepetitions of [1, 3]) {
    await t.test(`accepts ${acceptedRepetitions}`, () => {
      const input = validBenchmarkRun();
      input.repetitions = acceptedRepetitions;

      assert.equal(parseBenchmarkRun(input).repetitions, acceptedRepetitions);
    });
  }

  for (const invalidRepetitions of [0, 1.5, 4, Number.NaN, Number.POSITIVE_INFINITY]) {
    await t.test(`rejects ${String(invalidRepetitions)}`, () => {
      const input = validBenchmarkRun();
      input.repetitions = invalidRepetitions;

      assert.throws(() => parseBenchmarkRun(input));
    });
  }
});

test('benchmark candidate list accepts exactly one through eight candidates', async (t) => {
  for (const acceptedCount of [1, 8]) {
    await t.test(`accepts ${acceptedCount}`, () => {
      const input = validBenchmarkRun();
      input.candidates = Array.from({ length: acceptedCount }, (_, index) =>
        agentHarnessCandidate(index + 1),
      );

      assert.equal(parseBenchmarkRun(input).candidates.length, acceptedCount);
    });
  }

  for (const rejectedCount of [0, 9]) {
    await t.test(`rejects ${rejectedCount}`, () => {
      const input = validBenchmarkRun();
      input.candidates = Array.from({ length: rejectedCount }, (_, index) =>
        agentHarnessCandidate(index + 1),
      );

      assert.throws(() => parseBenchmarkRun(input));
    });
  }
});

test('benchmark run rejects duplicate routing candidates', () => {
  const input = validBenchmarkRun();
  input.candidates = [agentHarnessCandidate(), agentHarnessCandidate()];

  assert.throws(() => parseBenchmarkRun(input));
});

test('benchmark run rejects future-dated timestamps', () => {
  const input = validBenchmarkRun();
  input.createdAt = '9999-01-01T00:00:00.000Z';

  assert.throws(() => parseBenchmarkRun(input));
});

test('benchmark profile IDs reject control characters', () => {
  const input = validBenchmarkRun();
  input.candidates[0]!.modelProfileId = 'openrouter/example/model\nforged@1';

  assert.throws(() => parseBenchmarkRun(input));
});

test('benchmark arrays reject sparse entries with a contract error', () => {
  const input = validBenchmarkRun();
  input.candidates = new Array(1) as ReturnType<typeof validBenchmarkRun>['candidates'];

  assert.throws(
    () => parseBenchmarkRun(input),
    (error: unknown) =>
      error instanceof TypeError &&
      error.name === 'ContractValidationError' &&
      error.message.startsWith('benchmarkRun.candidates[0]:'),
  );
});

test('benchmark run requires closed, unique evidence and outcome fields', async (t) => {
  await t.test('preserves required evidence and outcome fields', () => {
    const parsed = parseBenchmarkRun(validBenchmarkRun());

    assert.ok(parsed.evidenceFields.includes('POLICY_VIOLATIONS'));
    assert.ok(parsed.outcomeFields.includes('CRITICAL_SAFETY_FAILURES'));
  });

  await t.test('rejects duplicate evidence fields', () => {
    const input = validBenchmarkRun();
    input.evidenceFields.push('FIXTURE_SHA256');

    assert.throws(() => parseBenchmarkRun(input));
  });

  await t.test('rejects unknown evidence fields', () => {
    const input = validBenchmarkRun();
    input.evidenceFields.push('MODEL_SELF_REPORTED_SCORE');

    assert.throws(() => parseBenchmarkRun(input));
  });

  await t.test('rejects duplicate outcome fields', () => {
    const input = validBenchmarkRun();
    input.outcomeFields.push('QUALITY_SCORE');

    assert.throws(() => parseBenchmarkRun(input));
  });

  await t.test('rejects unknown outcome fields', () => {
    const input = validBenchmarkRun();
    input.outcomeFields.push('UNVERIFIED_CLAIM');

    assert.throws(() => parseBenchmarkRun(input));
  });

  await t.test('cannot omit policy-violation evidence', () => {
    const input = validBenchmarkRun();
    input.evidenceFields = input.evidenceFields.filter((field) => field !== 'POLICY_VIOLATIONS');

    assert.throws(() => parseBenchmarkRun(input));
  });

  for (const requiredField of [
    'FIXTURE_SHA256',
    'PROMPT_HASH',
    'ENVIRONMENT_HASH',
    'ARTIFACT_REFS',
  ] as const) {
    await t.test(`cannot omit ${requiredField} evidence`, () => {
      const input = validBenchmarkRun();
      input.evidenceFields = input.evidenceFields.filter((field) => field !== requiredField);

      assert.throws(() => parseBenchmarkRun(input));
    });
  }

  await t.test('cannot omit the critical-safety outcome', () => {
    const input = validBenchmarkRun();
    input.outcomeFields = input.outcomeFields.filter(
      (field) => field !== 'CRITICAL_SAFETY_FAILURES',
    );

    assert.throws(() => parseBenchmarkRun(input));
  });

  for (const requiredField of [
    'COMPLETION_STATUS',
    'QUALITY_SCORE',
    'COST_MICRODOLLARS',
    'TOKEN_USAGE',
    'LATENCY_MS',
  ] as const) {
    await t.test(`cannot omit ${requiredField} outcome`, () => {
      const input = validBenchmarkRun();
      input.outcomeFields = input.outcomeFields.filter((field) => field !== requiredField);

      assert.throws(() => parseBenchmarkRun(input));
    });
  }
});

test('benchmark run rejects unknown fields, oversized IDs, and collapsed candidates', async (t) => {
  await t.test('unknown top-level fields are invalid', () => {
    const input = { ...validBenchmarkRun(), automaticPromotion: true };

    assert.throws(() => parseBenchmarkRun(input));
  });

  await t.test('fixture IDs longer than 128 characters are invalid', () => {
    const input = validBenchmarkRun();
    input.fixtureId = 'x'.repeat(129);

    assert.throws(() => parseBenchmarkRun(input));
  });

  await t.test('generic profileId cannot replace separate routing IDs', () => {
    const input = validBenchmarkRun() as unknown as {
      candidates: Array<{ profileId: string }>;
    };
    input.candidates = [{ profileId: 'agent-model-tools-combined' }];

    assert.throws(() => parseBenchmarkRun(input));
  });
});

test('promotion eligibility requires the full initial evidence gate and explicit approval', () => {
  const decision = evaluateTrustedPromotion();

  assert.equal(decision.eligible, true);
});

test('promotion evaluator rejects raw self-attested evidence and approval', () => {
  assert.throws(() =>
    evaluatePromotionEligibility({
      evidence: validPromotionEvidence(),
      userApproval: validPromotionApproval(),
    } as never),
  );
});

test('promotion is ineligible below ten distinct cases in the category', () => {
  const input = validPromotionEvidence();
  input.distinctCaseCount = 9;

  assert.equal(evaluateTrustedPromotion(input).eligible, false);
});

test('promotion is ineligible below three repetitions for every case', () => {
  const input = validPromotionEvidence();
  input.minimumRepetitionsPerCase = 2;

  assert.equal(evaluateTrustedPromotion(input).eligible, false);
});

test('any critical safety failure blocks promotion', () => {
  const input = validPromotionEvidence();
  input.criticalSafetyFailureCount = 1;

  assert.equal(evaluateTrustedPromotion(input).eligible, false);
});

test('promotion is ineligible while user approval is pending', () => {
  assert.equal(
    evaluateTrustedPromotion(validPromotionEvidence(), { status: 'PENDING' }).eligible,
    false,
  );
});

test('promotion cannot infer approval when the explicit approval record is absent', () => {
  const evidence = parseTrustedPromotionEvidence(validPromotionEvidence());

  assert.throws(() => evaluatePromotionEligibility({ evidence } as never));
});

test('promotion remains ineligible when immutable evidence is stale or misses quality', async (t) => {
  await t.test('evidence older than 30 days', () => {
    const input = validPromotionEvidence();
    input.createdAt = new Date(TEST_BASE_MS - 31 * DAY_MS).toISOString();

    const decision = evaluateTrustedPromotion(input);
    assert.equal(decision.eligible, false);
    assert.ok(decision.failedGates.includes('EVIDENCE_RECENCY'));
  });

  await t.test('quality gate not passed', () => {
    const input = validPromotionEvidence();
    input.qualityGatePassed = false;

    const decision = evaluateTrustedPromotion(input);
    assert.equal(decision.eligible, false);
    assert.ok(decision.failedGates.includes('QUALITY_GATE'));
  });
});

test('promotion approval is bound to the exact evidence and candidate version', async (t) => {
  await t.test('different evidence ID', () => {
    const approval = validPromotionApproval();
    approval.evidenceId = 'promotion-evidence-other-model';

    const decision = evaluateTrustedPromotion(validPromotionEvidence(), approval);
    assert.equal(decision.eligible, false);
    assert.ok(decision.failedGates.includes('VERSION_BINDING'));
  });

  await t.test('different candidate version', () => {
    const approval = validPromotionApproval();
    approval.candidate.modelProfileId = 'openrouter/example/model-1@catalog-2026-08-31';

    const decision = evaluateTrustedPromotion(validPromotionEvidence(), approval);
    assert.equal(decision.eligible, false);
    assert.ok(decision.failedGates.includes('VERSION_BINDING'));
  });
});

test('promotion timestamps reject future evidence and approvals', async (t) => {
  await t.test('future evidence', () => {
    const evidence = validPromotionEvidence();
    evidence.createdAt = '9999-01-01T00:00:00.000Z';

    assert.throws(() => parseTrustedPromotionEvidence(evidence));
  });

  await t.test('future approval', () => {
    const approval = validPromotionApproval();
    approval.approvedAt = '9999-01-01T00:00:00.000Z';

    assert.throws(() => parseTrustedPromotionUserApproval(approval));
  });

  await t.test('approval older than 30 days is ineligible', () => {
    const evidence = validPromotionEvidence();
    evidence.createdAt = new Date(TEST_BASE_MS - 32 * DAY_MS).toISOString();
    const approval = validPromotionApproval();
    approval.approvedAt = new Date(TEST_BASE_MS - 31 * DAY_MS).toISOString();

    const decision = evaluateTrustedPromotion(evidence, approval);
    assert.equal(decision.eligible, false);
    assert.ok(decision.failedGates.includes('APPROVAL_RECENCY'));
  });
});

test('promotion evidence rejects unknown fields and invalid numeric counts', async (t) => {
  await t.test('unknown promotion signals are invalid', () => {
    const input = { ...validPromotionEvidence(), userRating: 5 };

    assert.throws(() => parseTrustedPromotionEvidence(input));
  });

  for (const [field, invalidValue] of [
    ['distinctCaseCount', Number.NaN],
    ['minimumRepetitionsPerCase', Number.POSITIVE_INFINITY],
    ['criticalSafetyFailureCount', -1],
  ] as const) {
    await t.test(`rejects ${field}=${String(invalidValue)}`, () => {
      const input = validPromotionEvidence();
      input[field] = invalidValue;

      assert.throws(() => parseTrustedPromotionEvidence(input));
    });
  }
});
