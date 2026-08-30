import { createHash } from 'node:crypto';

import {
  createRoutingAssignmentValidationContext,
  parseDelegationIntent,
  parseDelegationPlan,
  parseRoutingAssignment,
  type AgentCapabilityDeclaration,
  type DelegationAuthority,
  type DelegationBudget,
  type DelegationPlan,
  type DelegationWorkItem,
  type RoutingAssignment,
} from '@monster-agent-hub/contracts';

import {
  DelegationPreviewInputError,
  normalizePreviewRegistry,
  normalizePreviewRequest,
  routingTupleKey,
} from './input.js';
import type {
  DelegationPreview,
  NormalizedPreviewRegistry,
  NormalizedRegistryCandidate,
  RoutingEvidenceFixture,
} from './types.js';

const PHASES = [
  {
    id: 'research',
    title: 'Research constraints and context',
    capabilityId: 'research',
    dependsOn: [] as readonly string[],
    objectivePrefix: 'Research constraints, existing context, and acceptance evidence for',
  },
  {
    id: 'implementation',
    title: 'Implement the bounded change',
    capabilityId: 'implementation',
    dependsOn: ['research'] as readonly string[],
    objectivePrefix: 'Implement a bounded, reversible change for',
  },
  {
    id: 'verification',
    title: 'Verify behavior and boundaries',
    capabilityId: 'verification',
    dependsOn: ['implementation'] as readonly string[],
    objectivePrefix: 'Verify behavior, limits, and authorization boundaries for',
  },
  {
    id: 'review',
    title: 'Review evidence and handoff',
    capabilityId: 'review',
    dependsOn: ['verification'] as readonly string[],
    objectivePrefix: 'Review the evidence, limitations, and handoff for',
  },
] as const;

const PLAN_AUTHORITY: DelegationAuthority = {
  workspaceGrantIds: ['workspace.monster-agent-hub.root', 'workspace.monster-agent-hub.hub-server'],
  toolGrantIds: ['tool.read-file', 'tool.search-files', 'tool.patch', 'tool.test'],
  networkGrantIds: [],
  credentialGrantIds: [],
  externalActionGrantIds: [],
};

const WORK_ITEM_AUTHORITY: DelegationAuthority = {
  workspaceGrantIds: ['workspace.monster-agent-hub.hub-server'],
  toolGrantIds: ['tool.read-file', 'tool.search-files', 'tool.patch', 'tool.test'],
  networkGrantIds: [],
  credentialGrantIds: [],
  externalActionGrantIds: [],
};

interface RankedCandidate {
  readonly entry: NormalizedRegistryCandidate;
  readonly capability: AgentCapabilityDeclaration;
  readonly evidence?: RoutingEvidenceFixture;
  readonly score: number;
}

interface AssignmentResult {
  readonly assignment: RoutingAssignment;
  readonly planFingerprint: string;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function allocatedShare(total: number, index: number): number {
  const base = Math.floor(total / PHASES.length);
  return base + (index < total % PHASES.length ? 1 : 0);
}

function workItemBudget(budget: DelegationBudget, index: number): DelegationBudget {
  return {
    maxCostMicrodollars: allocatedShare(budget.maxCostMicrodollars, index),
    maxTokens: allocatedShare(budget.maxTokens, index),
    maxDurationMs: allocatedShare(budget.maxDurationMs, index),
  };
}

function buildWorkItems(objective: string, budget: DelegationBudget): DelegationWorkItem[] {
  return PHASES.map((phase, index) => ({
    id: phase.id,
    title: phase.title,
    objective: `${phase.objectivePrefix}: ${objective}`,
    dependsOn: [...phase.dependsOn],
    requiredCapabilities: [phase.capabilityId],
    authority: {
      workspaceGrantIds: [...WORK_ITEM_AUTHORITY.workspaceGrantIds],
      toolGrantIds: [...WORK_ITEM_AUTHORITY.toolGrantIds],
      networkGrantIds: [],
      credentialGrantIds: [],
      externalActionGrantIds: [],
    },
    budget: workItemBudget(budget, index),
    attemptLimit: 1,
    handoffLimit: 1,
  }));
}

function profileBaseId(versionedProfileId: string): string {
  return versionedProfileId.slice(0, versionedProfileId.lastIndexOf('@'));
}

function evidenceKey(candidateKey: string, capabilityId: string): string {
  return JSON.stringify([candidateKey, capabilityId]);
}

function capabilityLevelScore(level: AgentCapabilityDeclaration['declaredLevel']): number {
  return level === 'EXPERT' ? 3 : level === 'STRONG' ? 2 : 1;
}

function supportScore(support: AgentCapabilityDeclaration['support']): number {
  return support === 'NATIVE' ? 2 : support === 'BRIDGED' ? 1 : 0;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rankCandidates(
  registry: NormalizedPreviewRegistry,
  workItem: DelegationWorkItem,
): RankedCandidate[] {
  const capabilityId = workItem.requiredCapabilities[0]!;
  const evidenceByKey = new Map(
    registry.evidence.map((fixture) => [
      evidenceKey(routingTupleKey(fixture.candidate), fixture.capabilityId),
      fixture,
    ]),
  );

  const ranked: RankedCandidate[] = [];
  for (const entry of registry.candidates) {
    const capability = entry.manifest.capabilities.find(
      (declaration) => declaration.capabilityId === capabilityId,
    );
    if (
      entry.availability !== 'AVAILABLE' ||
      entry.manifest.lifecycleState !== 'ACTIVE' ||
      !entry.manifest.launchModes.includes('DELEGATED') ||
      capability === undefined ||
      capability.support === 'UNSUPPORTED'
    ) {
      continue;
    }
    const toolProfileBaseId = profileBaseId(entry.candidate.toolProfileId);
    if (
      capability.requiredToolProfileIds.length > 0 &&
      !capability.requiredToolProfileIds.includes(toolProfileBaseId)
    ) {
      continue;
    }
    const workItemToolGrants = new Set(workItem.authority.toolGrantIds);
    if (entry.requiredToolGrantIds.some((grant) => !workItemToolGrants.has(grant))) {
      continue;
    }
    if (entry.expectedCostMicrodollars > workItem.budget.maxCostMicrodollars) {
      continue;
    }

    const candidateKey = routingTupleKey(entry.candidate);
    const evidence = evidenceByKey.get(evidenceKey(candidateKey, capabilityId));
    if (evidence !== undefined && evidence.criticalSafetyFailures > 0) {
      continue;
    }
    const score =
      (evidence?.qualityScore ?? 0) * 1_000 +
      capabilityLevelScore(capability.declaredLevel) * 100 +
      supportScore(capability.support) * 10 +
      Math.min(evidence?.caseCount ?? 0, 99);
    ranked.push({ entry, capability, ...(evidence === undefined ? {} : { evidence }), score });
  }

  return ranked.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.entry.expectedCostMicrodollars !== right.entry.expectedCostMicrodollars) {
      return left.entry.expectedCostMicrodollars - right.entry.expectedCostMicrodollars;
    }
    return compareAscii(
      routingTupleKey(left.entry.candidate),
      routingTupleKey(right.entry.candidate),
    );
  });
}

function confidenceFor(candidate: RankedCandidate): number {
  const evidenceConfidence =
    candidate.evidence === undefined
      ? 0
      : candidate.evidence.qualityScore * 0.006 +
        Math.min(candidate.evidence.caseCount, 50) * 0.003;
  const declarationConfidence =
    capabilityLevelScore(candidate.capability.declaredLevel) * 0.05 +
    supportScore(candidate.capability.support) * 0.04;
  return (
    Math.round(Math.min(0.99, 0.2 + evidenceConfidence + declarationConfidence) * 1_000) / 1_000
  );
}

function selectionReasons(candidate: RankedCandidate, workItem: DelegationWorkItem): string[] {
  const reasons = [
    `Versioned manifest declares ${candidate.capability.support} ${candidate.capability.declaredLevel} capability ${candidate.capability.capabilityId}.`,
  ];
  if (candidate.evidence === undefined) {
    reasons.push(
      'No benchmark evidence fixture was supplied; manifest evidence was ranked conservatively.',
    );
  } else {
    reasons.push(
      `Benchmark evidence scores ${candidate.evidence.qualityScore}/100 across ${candidate.evidence.caseCount} cases with zero critical safety failures.`,
    );
  }
  reasons.push('Availability fixture is AVAILABLE; the manifest probe was not executed.');
  reasons.push(
    `Estimated cost ${candidate.entry.expectedCostMicrodollars} microdollars fits the work-item ceiling ${workItem.budget.maxCostMicrodollars}.`,
  );
  return reasons;
}

function assignmentFor(
  plan: DelegationPlan,
  planRevision: number,
  registry: NormalizedPreviewRegistry,
  workItem: DelegationWorkItem,
): AssignmentResult {
  const ranked = rankCandidates(registry, workItem);
  if (ranked.length === 0) {
    throw new DelegationPreviewInputError(
      `previewRegistry.candidates.${workItem.id}`,
      `has no safe eligible tuple for capability ${workItem.requiredCapabilities[0]}`,
    );
  }
  const selected = ranked[0]!;
  const alternatives = ranked.slice(1, 4).map((candidate) => candidate.entry.candidate);
  const assignmentId = `assignment.${workItem.id}.${hashValue({
    planId: plan.id,
    candidate: selected.entry.candidate,
  }).slice(0, 16)}`;
  const routingContext = createRoutingAssignmentValidationContext({
    plan,
    planRevision,
    registrySnapshotId: registry.snapshotId,
    eligibleCandidates: ranked.map((candidate) => ({
      candidate: candidate.entry.candidate,
      requiredToolGrantIds: candidate.entry.requiredToolGrantIds,
      requiredApprovalIds: candidate.entry.requiredApprovalIds,
    })),
  });

  const assignment = parseRoutingAssignment(
    {
      schemaVersion: 1,
      id: assignmentId,
      planId: plan.id,
      planRevision,
      planFingerprint: routingContext.planFingerprint,
      registrySnapshotId: registry.snapshotId,
      workItemId: workItem.id,
      expiresAt: plan.expiresAt,
      candidate: selected.entry.candidate,
      selectionReasons: selectionReasons(selected, workItem),
      alternatives,
      expectedCostMicrodollars: selected.entry.expectedCostMicrodollars,
      confidence: confidenceFor(selected),
      requiredApprovals: selected.entry.requiredApprovalIds,
    },
    routingContext,
  );
  return { assignment, planFingerprint: routingContext.planFingerprint };
}

export function getReadyWorkItemIds(
  plan: DelegationPlan,
  completedWorkItemIds: readonly string[],
): string[] {
  if (!Array.isArray(completedWorkItemIds) || completedWorkItemIds.length > 16) {
    throw new DelegationPreviewInputError(
      'completedWorkItemIds',
      'must be an array containing at most 16 work-item IDs',
    );
  }
  const knownIds = new Set(plan.workItems.map((item) => item.id));
  const completed = new Set<string>();
  for (const [index, id] of completedWorkItemIds.entries()) {
    if (typeof id !== 'string' || !knownIds.has(id)) {
      throw new DelegationPreviewInputError(
        `completedWorkItemIds[${index}]`,
        'does not name a work item in the plan',
      );
    }
    if (completed.has(id)) {
      throw new DelegationPreviewInputError(
        'completedWorkItemIds',
        'must not contain duplicate work-item IDs',
      );
    }
    completed.add(id);
  }

  return plan.workItems
    .filter(
      (item) =>
        !completed.has(item.id) && item.dependsOn.every((dependency) => completed.has(dependency)),
    )
    .map((item) => item.id);
}

export function createDelegationPreview(
  requestInput: unknown,
  registryInput: unknown,
): DelegationPreview {
  const request = normalizePreviewRequest(requestInput);
  const registry = normalizePreviewRegistry(registryInput);
  const intentSeed = {
    schemaVersion: 1,
    objective: request.objective,
    requestedBy: request.requestedBy,
    previewedAt: request.previewedAt,
    planRevision: request.planRevision,
    budget: request.budget,
  };
  const intent = parseDelegationIntent({
    schemaVersion: 1,
    id: `intent.${hashValue(intentSeed).slice(0, 24)}`,
    objective: request.objective,
    requestedBy: request.requestedBy,
    requestedAt: request.previewedAt,
    authority: PLAN_AUTHORITY,
    budget: request.budget,
  });

  const createdAtMs = Date.parse(request.previewedAt);
  const expiresAt = new Date(createdAtMs + request.planTtlMs).toISOString();
  const workItems = buildWorkItems(request.objective, request.budget);
  const planSeed = {
    intentId: intent.id,
    objective: request.objective,
    createdAt: request.previewedAt,
    expiresAt,
    maxConcurrency: request.maxConcurrency,
    workItems,
  };
  const plan = parseDelegationPlan(
    {
      schemaVersion: 1,
      id: `plan.${hashValue(planSeed).slice(0, 24)}`,
      intentId: intent.id,
      objective: request.objective,
      createdAt: request.previewedAt,
      expiresAt,
      authority: PLAN_AUTHORITY,
      budget: request.budget,
      maxConcurrency: request.maxConcurrency,
      workItems,
    },
    { intent },
  );
  const assignmentResults = plan.workItems.map((workItem) =>
    assignmentFor(plan, request.planRevision, registry, workItem),
  );
  const planFingerprint = assignmentResults[0]!.planFingerprint;
  const assignments = assignmentResults.map((result) => result.assignment);
  const readyWorkItemIds = getReadyWorkItemIds(plan, []);
  const readyIds = new Set(readyWorkItemIds);

  return deepFreeze({
    mode: 'PREVIEW_ONLY',
    intent,
    plan,
    planRevision: request.planRevision,
    planFingerprint,
    registrySnapshotId: registry.snapshotId,
    assignments,
    estimatedTotalCostMicrodollars: assignments.reduce(
      (total, assignment) => total + assignment.expectedCostMicrodollars,
      0,
    ),
    readiness: {
      completedWorkItemIds: [],
      readyWorkItemIds,
      blockedWorkItemIds: plan.workItems
        .filter((workItem) => !readyIds.has(workItem.id))
        .map((workItem) => workItem.id),
    },
    sideEffects: [],
  });
}
