import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ContractValidationError,
  createRoutingAssignmentValidationContext,
  parseDelegationIntent,
  parseDelegationPlan,
  parseRoutingAssignment,
} from '../src/index.ts';

function assertContractError(action: () => unknown, expectedPath: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.equal(error.path, expectedPath);
    return true;
  });
}

const ROOT_WORKSPACE_GRANT = 'workspace.monster-agent-hub.root';
const CONTRACTS_WORKSPACE_GRANT = 'workspace.monster-agent-hub.contracts';
const TEST_BASE_MS = Date.now();
const REGISTRY_SNAPSHOT_ID = 'registry.agents.2026-08-30.1';

function parentAuthority() {
  return {
    workspaceGrantIds: [ROOT_WORKSPACE_GRANT, CONTRACTS_WORKSPACE_GRANT],
    toolGrantIds: ['tool.read-file', 'tool.search-files', 'tool.patch', 'tool.terminal'],
    networkGrantIds: ['network.openrouter-api'],
    credentialGrantIds: ['credential.openrouter'],
    externalActionGrantIds: ['action.git-commit'],
  };
}

function childAuthority() {
  return {
    workspaceGrantIds: [CONTRACTS_WORKSPACE_GRANT],
    toolGrantIds: ['tool.read-file', 'tool.patch'],
    networkGrantIds: [],
    credentialGrantIds: [],
    externalActionGrantIds: [],
  };
}

function validIntent() {
  return {
    schemaVersion: 1,
    id: 'intent-orchestration-contracts',
    objective: 'Define and verify the first bounded delegation contracts.',
    requestedBy: 'paul',
    requestedAt: new Date(TEST_BASE_MS - 60_000).toISOString(),
    authority: parentAuthority(),
    budget: {
      maxCostMicrodollars: 2_000_000,
      maxTokens: 20_000,
      maxDurationMs: 600_000,
    },
  };
}

function validWorkItem(id: string) {
  return {
    id,
    title: `Complete ${id}`,
    objective: `Produce evidence for ${id}.`,
    dependsOn: [] as string[],
    requiredCapabilities: ['typescript'],
    authority: childAuthority(),
    budget: {
      maxCostMicrodollars: 250_000,
      maxTokens: 2_500,
      maxDurationMs: 60_000,
    },
    attemptLimit: 2,
    handoffLimit: 2,
  };
}

function validPlan() {
  const research = validWorkItem('research-contracts');
  const implementation = validWorkItem('implement-contracts');
  implementation.dependsOn = [research.id];

  return {
    schemaVersion: 1,
    id: 'plan-orchestration-contracts',
    intentId: 'intent-orchestration-contracts',
    objective: 'Research and implement bounded orchestration contracts.',
    createdAt: new Date(TEST_BASE_MS).toISOString(),
    expiresAt: new Date(TEST_BASE_MS + 3 * 60 * 60 * 1_000).toISOString(),
    authority: parentAuthority(),
    budget: {
      maxCostMicrodollars: 2_000_000,
      maxTokens: 20_000,
      maxDurationMs: 600_000,
    },
    maxConcurrency: 2,
    workItems: [research, implementation],
  };
}

function parseAuthorizedPlan(
  input: ReturnType<typeof validPlan>,
  intent: ReturnType<typeof validIntent> = validIntent(),
) {
  return parseDelegationPlan(input, { intent: parseDelegationIntent(intent) });
}

function validRoutingAssignment() {
  return {
    schemaVersion: 1,
    id: 'assignment-implement-contracts',
    planId: 'plan-orchestration-contracts',
    planRevision: 1,
    planFingerprint: `sha256:${'0'.repeat(64)}`,
    registrySnapshotId: REGISTRY_SNAPSHOT_ID,
    workItemId: 'implement-contracts',
    expiresAt: new Date(TEST_BASE_MS + 30 * 60_000).toISOString(),
    candidate: {
      agentProfileId: 'codex-windows@0.150.1',
      modelProfileId: 'openai/gpt-5.6@2026-08-30',
      toolProfileId: 'patch-test-only@1',
    },
    selectionReasons: ['Strong measured TypeScript contract-test performance.'],
    alternatives: [
      {
        agentProfileId: 'claude-code-windows@2.1.251',
        modelProfileId: 'anthropic/claude-sonnet-4.6@2026-08-30',
        toolProfileId: 'patch-test-only@1',
      },
    ],
    expectedCostMicrodollars: 200_000,
    confidence: 0.82,
    requiredApprovals: [],
  };
}

function parseAuthorizedRoutingAssignment(
  input: ReturnType<typeof validRoutingAssignment>,
  overrides: Partial<{
    plan: ReturnType<typeof parseAuthorizedPlan>;
    planRevision: number;
    planFingerprint: string;
    registrySnapshotId: string;
    primaryToolGrantIds: string[];
    requiredApprovalIds: string[];
  }> = {},
) {
  const fixture = validRoutingAssignment();
  const context = createRoutingAssignmentValidationContext({
    plan: parseAuthorizedPlan(validPlan()),
    planRevision: 1,
    registrySnapshotId: REGISTRY_SNAPSHOT_ID,
    eligibleCandidates: [
      {
        candidate: fixture.candidate,
        requiredToolGrantIds: overrides.primaryToolGrantIds ?? ['tool.patch'],
        requiredApprovalIds: overrides.requiredApprovalIds ?? [],
      },
      ...fixture.alternatives.map((candidate) => ({
        candidate,
        requiredToolGrantIds: ['tool.patch'],
        requiredApprovalIds: [],
      })),
    ],
    ...(overrides.plan === undefined ? {} : { plan: overrides.plan }),
    ...(overrides.planRevision === undefined ? {} : { planRevision: overrides.planRevision }),
    ...(overrides.registrySnapshotId === undefined
      ? {}
      : { registrySnapshotId: overrides.registrySnapshotId }),
  });
  const assignment = {
    ...input,
    planFingerprint:
      overrides.planFingerprint ??
      (input.planFingerprint === `sha256:${'0'.repeat(64)}`
        ? context.planFingerprint
        : input.planFingerprint),
  };
  return parseRoutingAssignment(assignment, context);
}

test('delegation intent accepts a valid bounded objective', () => {
  const parsed = parseDelegationIntent(validIntent());

  assert.equal(parsed.id, 'intent-orchestration-contracts');
  assert.equal(parsed.authority.workspaceGrantIds[0], ROOT_WORKSPACE_GRANT);
  assert.equal(parsed.budget.maxCostMicrodollars, 2_000_000);
});

test('delegation plan accepts a valid dependency graph', () => {
  const parsed = parseAuthorizedPlan(validPlan());

  assert.equal(parsed.workItems.length, 2);
  assert.deepEqual(parsed.workItems[1]?.dependsOn, ['research-contracts']);
  assert.equal(parsed.maxConcurrency, 2);
});

test('delegation plan rejects more than 16 work items', () => {
  const input = validPlan();
  input.workItems = Array.from({ length: 17 }, (_, index) => {
    const item = validWorkItem(`task-${index + 1}`);
    item.budget = {
      maxCostMicrodollars: 10_000,
      maxTokens: 100,
      maxDurationMs: 1_000,
    };
    return item;
  });

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects dependency cycles', () => {
  const input = validPlan();
  input.workItems[0]!.dependsOn = [input.workItems[1]!.id];
  input.workItems[1]!.dependsOn = [input.workItems[0]!.id];

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects dependencies that do not name a work item', () => {
  const input = validPlan();
  input.workItems[1]!.dependsOn = ['missing-work-item'];

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects duplicate work item IDs', () => {
  const input = validPlan();
  input.workItems[1]!.id = input.workItems[0]!.id;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation identifiers reject control characters that could forge audit lines', () => {
  const input = validPlan();
  input.workItems[0]!.id = 'research\nforged-audit-entry';
  input.workItems[1]!.dependsOn = [input.workItems[0]!.id];

  assertContractError(() => parseAuthorizedPlan(input), 'delegationPlan.workItems[0].id');
});

test('delegation capability IDs must be stable identifiers', () => {
  const input = validPlan();
  input.workItems[0]!.requiredCapabilities = ['typescript\nforged-audit-entry'];

  assertContractError(
    () => parseAuthorizedPlan(input),
    'delegationPlan.workItems[0].requiredCapabilities[0]',
  );
});

test('delegation plan rejects decomposition deeper than two child levels', () => {
  const root = validWorkItem('root-task');
  const child = { ...validWorkItem('child-task'), parentWorkItemId: root.id };
  const grandchild = {
    ...validWorkItem('grandchild-task'),
    parentWorkItemId: child.id,
  };
  const tooDeep = {
    ...validWorkItem('too-deep-task'),
    parentWorkItemId: grandchild.id,
  };
  const input = validPlan();
  input.workItems = [root, child, grandchild, tooDeep];

  assert.throws(() => parseAuthorizedPlan(input));
});

for (const authorityExpansion of [
  {
    dimension: 'workspace grant',
    mutate: (authority: ReturnType<typeof childAuthority>) => {
      authority.workspaceGrantIds = ['workspace.another-project.root'];
    },
  },
  {
    dimension: 'tool grant',
    mutate: (authority: ReturnType<typeof childAuthority>) => {
      authority.toolGrantIds.push('tool.deploy');
    },
  },
  {
    dimension: 'network grant',
    mutate: (authority: ReturnType<typeof childAuthority>) => {
      authority.networkGrantIds.push('network.unapproved');
    },
  },
  {
    dimension: 'credential grant',
    mutate: (authority: ReturnType<typeof childAuthority>) => {
      authority.credentialGrantIds.push('credential.unapproved');
    },
  },
  {
    dimension: 'external action grant',
    mutate: (authority: ReturnType<typeof childAuthority>) => {
      authority.externalActionGrantIds.push('action.git-push');
    },
  },
]) {
  test(`delegation plan rejects child authority ${authorityExpansion.dimension} expansion`, () => {
    const input = validPlan();
    authorityExpansion.mutate(input.workItems[0]!.authority);

    assert.throws(() => parseAuthorizedPlan(input));
  });
}

test('delegation plan requires each child authority to be a strict subset', () => {
  const input = validPlan();
  input.workItems[0]!.authority = structuredClone(input.authority);

  assertContractError(
    () => parseAuthorizedPlan(input),
    'delegationPlan.workItems.research-contracts.authority',
  );
});

test('delegation authority accepts only opaque namespaced grant IDs', () => {
  const input = validIntent();
  input.authority.credentialGrantIds = ['provider-secret-token'];

  assertContractError(
    () => parseDelegationIntent(input),
    'delegationIntent.authority.credentialGrantIds[0]',
  );
});

test('delegation plan rejects a child budget above its parent plan budget', () => {
  const input = validPlan();
  input.workItems[0]!.budget.maxCostMicrodollars = 2_000_001;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects aggregate child budgets above the plan budget', () => {
  const input = validPlan();
  input.workItems[0]!.budget.maxCostMicrodollars = 1_100_000;
  input.workItems[1]!.budget.maxCostMicrodollars = 1_100_000;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects a positive child cost under a zero budget', () => {
  const input = validPlan();
  input.budget.maxCostMicrodollars = 0;
  input.workItems[0]!.budget.maxCostMicrodollars = 1;
  input.workItems[1]!.budget.maxCostMicrodollars = 0;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation budget rejects costs outside safe-integer microdollars', () => {
  const input = validPlan();
  input.budget.maxCostMicrodollars = Number.MAX_VALUE;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation budgets reject costs above the practical server policy ceiling', () => {
  const input = validIntent();
  input.budget.maxCostMicrodollars = 100_000_001;

  assert.throws(() => parseDelegationIntent(input));
});

test('delegation plan rejects concurrency above three', () => {
  const input = validPlan();
  input.maxConcurrency = 4;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects a TTL longer than four hours', () => {
  const input = validPlan();
  input.expiresAt = new Date(Date.parse(input.createdAt) + 4 * 60 * 60 * 1_000 + 1).toISOString();

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects a plan expired at validation time', () => {
  const input = validPlan();
  input.createdAt = new Date(TEST_BASE_MS - 2 * 60_000).toISOString();
  input.expiresAt = new Date(TEST_BASE_MS - 60_000).toISOString();

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects a future-dated creation time', () => {
  const input = validPlan();
  input.createdAt = new Date(TEST_BASE_MS + 5 * 60_000).toISOString();
  input.expiresAt = new Date(TEST_BASE_MS + 65 * 60_000).toISOString();

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan must be linked to the authorizing intent', () => {
  const input = validPlan();
  const intent = validIntent();
  intent.id = 'intent-for-a-different-request';

  assert.throws(() => parseAuthorizedPlan(input, intent));
});

test('delegation plan cannot exceed the authorizing intent budget', () => {
  const input = validPlan();
  const intent = validIntent();
  intent.budget.maxCostMicrodollars = 1_000_000;

  assert.throws(() => parseAuthorizedPlan(input, intent));
});

test('delegation plan cannot predate the authorizing intent', () => {
  const input = validPlan();
  const intent = validIntent();
  input.createdAt = new Date(TEST_BASE_MS - 2 * 60_000).toISOString();
  input.expiresAt = new Date(TEST_BASE_MS + 60_000).toISOString();

  assert.throws(() => parseAuthorizedPlan(input, intent));
});

test('delegation intent rejects a future-dated request time', () => {
  const input = validIntent();
  input.requestedAt = new Date(TEST_BASE_MS + 5 * 60_000).toISOString();

  assert.throws(() => parseDelegationIntent(input));
});

test('delegation plan rejects an unvalidated intent context', () => {
  assert.throws(() => parseDelegationPlan(validPlan(), { intent: validIntent() }));
});

test('delegation plan rejects more than two attempts per candidate', () => {
  const input = validPlan();
  input.workItems[0]!.attemptLimit = 3;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation plan rejects more than two cross-agent handoffs per work item', () => {
  const input = validPlan();
  input.workItems[0]!.handoffLimit = 3;

  assert.throws(() => parseAuthorizedPlan(input));
});

test('delegation intent rejects invalid and oversized strings', async (t) => {
  await t.test('blank IDs are invalid', () => {
    const input = validIntent();
    input.id = '   ';

    assert.throws(() => parseDelegationIntent(input));
  });

  await t.test('objectives longer than 4096 characters are invalid', () => {
    const input = validIntent();
    input.objective = 'x'.repeat(4_097);

    assert.throws(() => parseDelegationIntent(input));
  });
});

test('delegation plan rejects invalid and oversized arrays', async (t) => {
  await t.test('dependencies must be an array', () => {
    const input = validPlan() as unknown as {
      workItems: Array<{ dependsOn: unknown }>;
    };
    input.workItems[0]!.dependsOn = 'research-contracts';

    assert.throws(() => parseAuthorizedPlan(input));
  });

  await t.test('a work item cannot request more than 32 capabilities', () => {
    const input = validPlan();
    input.workItems[0]!.requiredCapabilities = Array.from(
      { length: 33 },
      (_, index) => `capability-${index + 1}`,
    );

    assert.throws(() => parseAuthorizedPlan(input));
  });

  await t.test('sparse work-item arrays fail with a contract error', () => {
    const input = validPlan();
    input.workItems = new Array(1) as ReturnType<typeof validPlan>['workItems'];

    assertContractError(() => parseAuthorizedPlan(input), 'delegationPlan.workItems[0]');
  });
});

test('routing assignment preserves distinct agent, model, and tool profiles', () => {
  const parsed = parseAuthorizedRoutingAssignment(validRoutingAssignment());

  assert.equal(parsed.candidate.agentProfileId, 'codex-windows@0.150.1');
  assert.equal(parsed.candidate.modelProfileId, 'openai/gpt-5.6@2026-08-30');
  assert.equal(parsed.candidate.toolProfileId, 'patch-test-only@1');
  assert.notEqual(parsed.candidate.agentProfileId, parsed.candidate.modelProfileId);
});

test('routing assignment rejects a collapsed generic profile identifier', () => {
  const input = validRoutingAssignment() as unknown as {
    candidate: { profileId: string };
  };
  input.candidate = { profileId: 'codex-gpt5-full-tools' };

  assert.throws(() => parseAuthorizedRoutingAssignment(input));
});

test('routing assignment is bound to the authorized plan revision and fingerprint', async (t) => {
  await t.test('plan ID', () => {
    const input = validRoutingAssignment();
    input.planId = 'plan-somewhere-else';
    assert.throws(() => parseAuthorizedRoutingAssignment(input));
  });

  await t.test('plan revision', () => {
    const input = validRoutingAssignment();
    input.planRevision = 2;
    assert.throws(() => parseAuthorizedRoutingAssignment(input));
  });

  await t.test('plan fingerprint', () => {
    const input = validRoutingAssignment();
    input.planFingerprint = `sha256:${'b'.repeat(64)}`;
    assert.throws(() => parseAuthorizedRoutingAssignment(input));
  });

  await t.test('registry snapshot', () => {
    const input = validRoutingAssignment();
    input.registrySnapshotId = 'registry.agents.different';
    assert.throws(() => parseAuthorizedRoutingAssignment(input));
  });
});

test('routing assignment rejects a structurally forged registry validation context', () => {
  const plan = parseAuthorizedPlan(validPlan());
  const fixture = validRoutingAssignment();
  const forgedContext = {
    plan,
    planRevision: 1,
    planFingerprint: `sha256:${'a'.repeat(64)}`,
    registrySnapshotId: REGISTRY_SNAPSHOT_ID,
    eligibleCandidates: [fixture.candidate, ...fixture.alternatives].map((candidate) => ({
      candidate,
      requiredToolGrantIds: ['tool.patch'],
      requiredApprovalIds: [],
    })),
  };

  assertContractError(
    () => parseRoutingAssignment(fixture, forgedContext),
    'routingAssignmentContext',
  );
});

test('routing context computes the plan fingerprint instead of accepting caller input', () => {
  const fixture = validRoutingAssignment();
  const input = {
    plan: parseAuthorizedPlan(validPlan()),
    planRevision: 1,
    registrySnapshotId: REGISTRY_SNAPSHOT_ID,
    eligibleCandidates: [fixture.candidate, ...fixture.alternatives].map((candidate) => ({
      candidate,
      requiredToolGrantIds: ['tool.patch'],
      requiredApprovalIds: [],
    })),
  };
  const context = createRoutingAssignmentValidationContext(input);
  const expectedFingerprint = `sha256:${createHash('sha256')
    .update(JSON.stringify(context.plan))
    .digest('hex')}`;

  assert.equal(context.planFingerprint, expectedFingerprint);
  assertContractError(
    () =>
      createRoutingAssignmentValidationContext({
        ...input,
        planFingerprint: `sha256:${'a'.repeat(64)}`,
      } as never),
    'routingAssignmentContext.planFingerprint',
  );
});

test('routing assignment rejects replay after expiration', () => {
  const input = validRoutingAssignment();
  input.expiresAt = new Date(TEST_BASE_MS - 1).toISOString();

  assert.throws(() => parseAuthorizedRoutingAssignment(input));
});

test('routing assignment rejects a candidate outside the eligible registry snapshot', () => {
  const input = validRoutingAssignment();
  input.candidate.toolProfileId = 'full-host-control@1';

  assert.throws(() => parseAuthorizedRoutingAssignment(input));
});

test('routing assignment profile IDs reject control characters', () => {
  const input = validRoutingAssignment();
  input.candidate.agentProfileId = 'codex-windows\nforged@1';

  assert.throws(() => parseAuthorizedRoutingAssignment(input));
});

test('routing assignment cost must fit the target work-item budget', () => {
  const input = validRoutingAssignment();
  input.expectedCostMicrodollars = 250_001;

  assert.throws(() => parseAuthorizedRoutingAssignment(input));
});

test('routing assignment includes every approval required by policy', () => {
  const input = validRoutingAssignment();

  assert.throws(() =>
    parseAuthorizedRoutingAssignment(input, {
      requiredApprovalIds: ['approval.write-capable-tools'],
    }),
  );
});

test('routing assignment tool profile grants must fit work-item authority', () => {
  const input = validRoutingAssignment();

  assert.throws(() =>
    parseAuthorizedRoutingAssignment(input, {
      primaryToolGrantIds: ['tool.deploy'],
    }),
  );
});

test('contract parsers reject objects with inherited contract fields', () => {
  const inheritedIntent = Object.create({
    ...validIntent(),
    hiddenAuthorityExpansion: 'deploy',
  }) as ReturnType<typeof validIntent>;

  assert.throws(() => parseDelegationIntent(inheritedIntent));
});

test('parsed contracts are deeply immutable at runtime', () => {
  const plan = parseAuthorizedPlan(validPlan());
  const assignment = parseAuthorizedRoutingAssignment(validRoutingAssignment());

  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.workItems));
  assert.ok(Object.isFrozen(plan.workItems[0]!.authority.toolGrantIds));
  assert.ok(Object.isFrozen(assignment));
  assert.ok(Object.isFrozen(assignment.candidate));
  assert.throws(() => {
    (plan.workItems[0]!.authority.toolGrantIds as string[]).push('tool.deploy');
  }, TypeError);
});
