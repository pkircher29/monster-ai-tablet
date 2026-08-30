import { parseAgentManifest, type RoutingCandidate } from '@monster-agent-hub/contracts';

import type {
  CandidateAvailability,
  DelegationPreviewRequest,
  NormalizedPreviewRegistry,
  NormalizedRegistryCandidate,
  RoutingEvidenceFixture,
} from './types.js';

const MAX_OBJECTIVE_LENGTH = 1_024;
const MAX_REGISTRY_CANDIDATES = 32;
const MAX_EVIDENCE_FIXTURES = 512;
const MAX_TOOL_GRANTS = 32;
const MAX_APPROVALS = 16;
const MAX_PLAN_TTL_MS = 4 * 60 * 60 * 1_000;
const MAX_PREVIEW_COST_MICRODOLLARS = 100_000_000;
const MAX_PREVIEW_TOKENS = 1_000_000;
const PHASE_COUNT = 4;
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PROFILE_ID_PATTERN = /^[^\s@]{1,191}@[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const UNSAFE_OBJECTIVE_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:git\s+)?push\b/i, 'source-control push'],
  [/(?:^|\b(?:then|and)\s+)(?:please\s+)?deploy\b/i, 'deployment'],
  [/(?:^|\b(?:then|and)\s+)(?:please\s+)?(?:buy|purchase|checkout)\b/i, 'purchase'],
  [/\b(?:send|post)\s+(?:an?\s+)?(?:email|message|sms|notification|tweet|post)\b/i, 'messaging'],
  [
    /\b(?:read|show|reveal|export|copy|change|reset|rotate)\b.{0,32}\b(?:credential|password|token|secret)s?\b/i,
    'credential access',
  ],
  [/\badb\b/i, 'ADB device control'],
  [/\b(?:root|flash|unlock)\b.{0,24}\b(?:device|tablet|bootloader)\b/i, 'device modification'],
  [
    /\b(?:delete|erase|wipe)\b.{0,24}\b(?:all|repository|workspace|files?)\b/i,
    'destructive file action',
  ],
  [/\bignore\s+(?:all\s+)?(?:previous|system)\s+instructions?\b/i, 'instruction override'],
];

type UnknownRecord = Readonly<Record<string, unknown>>;

export class DelegationPreviewInputError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'DelegationPreviewInputError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new DelegationPreviewInputError(path, message);
}

function parseRecord(value: unknown, path: string, allowedKeys: readonly string[]): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(path, 'must not contain symbol fields');
  }

  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) {
      fail(`${path}.${key.slice(0, 128)}`, 'is not a recognized field');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      fail(`${path}.${key.slice(0, 128)}`, 'must be a data field');
    }
  }
  return value as UnknownRecord;
}

function parseArray(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(path, 'must be an array');
  }
  if (value.length < minimum || value.length > maximum) {
    fail(path, `must contain between ${minimum} and ${maximum} items`);
  }
  return value;
}

function parseBoundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string') {
    fail(path, 'must be a string');
  }
  if (value.length === 0 || value.length > maximum || value !== value.trim()) {
    fail(path, `must be trimmed and contain between 1 and ${maximum} characters`);
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    fail(path, 'must not contain control characters');
  }
  return value;
}

function parseStableId(value: unknown, path: string, prefix?: string): string {
  const parsed = parseBoundedString(value, path, 128);
  if (!STABLE_ID_PATTERN.test(parsed)) {
    fail(path, 'must be a lowercase stable identifier');
  }
  if (prefix !== undefined && !parsed.startsWith(`${prefix}.`)) {
    fail(path, `must be an opaque ${prefix} identifier`);
  }
  return parsed;
}

function parseVersionedProfileId(value: unknown, path: string): string {
  const parsed = parseBoundedString(value, path, 256);
  if (!PROFILE_ID_PATTERN.test(parsed)) {
    fail(path, 'must include a non-empty profile ID and explicit @version');
  }
  return parsed;
}

function parseSafeInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) {
    fail(path, 'must be a safe integer');
  }
  const parsed = value as number;
  if (parsed < minimum || parsed > maximum) {
    fail(path, `must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseScore(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    fail(path, 'must be a finite number between 0 and 100');
  }
  return value;
}

function parseGrantList(value: unknown, path: string, namespace: 'tool' | 'approval'): string[] {
  const maximum = namespace === 'tool' ? MAX_TOOL_GRANTS : MAX_APPROVALS;
  const grants = parseArray(value, path, maximum).map((grant, index) =>
    parseStableId(grant, `${path}[${index}]`, namespace),
  );
  if (new Set(grants).size !== grants.length) {
    fail(path, 'must not contain duplicate grants');
  }
  return grants;
}

function tupleKey(candidate: RoutingCandidate): string {
  return JSON.stringify([
    candidate.agentProfileId,
    candidate.modelProfileId,
    candidate.toolProfileId,
  ]);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareAscii);
}

function parseCandidate(value: unknown, path: string): NormalizedRegistryCandidate {
  const record = parseRecord(value, path, [
    'manifest',
    'availability',
    'modelProfileId',
    'toolProfileId',
    'requiredToolGrantIds',
    'requiredApprovalIds',
    'expectedCostMicrodollars',
  ]);
  const manifest = parseAgentManifest(record.manifest);
  const availability = record.availability;
  if (availability !== 'AVAILABLE' && availability !== 'UNAVAILABLE') {
    fail(`${path}.availability`, 'must be AVAILABLE or UNAVAILABLE');
  }
  const agentProfileId = parseVersionedProfileId(
    `${manifest.id}@${manifest.version}`,
    `${path}.manifest.version`,
  );
  const candidate: RoutingCandidate = {
    agentProfileId,
    modelProfileId: parseVersionedProfileId(record.modelProfileId, `${path}.modelProfileId`),
    toolProfileId: parseVersionedProfileId(record.toolProfileId, `${path}.toolProfileId`),
  };
  const manifestApprovals = manifest.requiredApprovals.map((approval, index) =>
    parseStableId(approval, `${path}.manifest.requiredApprovals[${index}]`, 'approval'),
  );
  const requiredApprovalIds = uniqueSorted([
    ...manifestApprovals,
    ...parseGrantList(record.requiredApprovalIds, `${path}.requiredApprovalIds`, 'approval'),
  ]);
  if (requiredApprovalIds.length > MAX_APPROVALS) {
    fail(`${path}.requiredApprovalIds`, `must bind at most ${MAX_APPROVALS} approvals in total`);
  }

  return {
    manifest,
    availability: availability as CandidateAvailability,
    candidate,
    requiredToolGrantIds: parseGrantList(
      record.requiredToolGrantIds,
      `${path}.requiredToolGrantIds`,
      'tool',
    ),
    requiredApprovalIds,
    expectedCostMicrodollars: parseSafeInteger(
      record.expectedCostMicrodollars,
      `${path}.expectedCostMicrodollars`,
      0,
      MAX_PREVIEW_COST_MICRODOLLARS,
    ),
  };
}

function parseEvidence(value: unknown, path: string): RoutingEvidenceFixture {
  const record = parseRecord(value, path, [
    'candidate',
    'capabilityId',
    'qualityScore',
    'caseCount',
    'criticalSafetyFailures',
  ]);
  const candidateRecord = parseRecord(record.candidate, `${path}.candidate`, [
    'agentProfileId',
    'modelProfileId',
    'toolProfileId',
  ]);
  return {
    candidate: {
      agentProfileId: parseVersionedProfileId(
        candidateRecord.agentProfileId,
        `${path}.candidate.agentProfileId`,
      ),
      modelProfileId: parseVersionedProfileId(
        candidateRecord.modelProfileId,
        `${path}.candidate.modelProfileId`,
      ),
      toolProfileId: parseVersionedProfileId(
        candidateRecord.toolProfileId,
        `${path}.candidate.toolProfileId`,
      ),
    },
    capabilityId: parseStableId(record.capabilityId, `${path}.capabilityId`),
    qualityScore: parseScore(record.qualityScore, `${path}.qualityScore`),
    caseCount: parseSafeInteger(record.caseCount, `${path}.caseCount`, 1, 10_000),
    criticalSafetyFailures: parseSafeInteger(
      record.criticalSafetyFailures,
      `${path}.criticalSafetyFailures`,
      0,
      10_000,
    ),
  };
}

function parseObjective(value: unknown): string {
  const objective = parseBoundedString(value, 'previewRequest.objective', MAX_OBJECTIVE_LENGTH);
  for (const [pattern, operation] of UNSAFE_OBJECTIVE_PATTERNS) {
    if (pattern.test(objective)) {
      fail(
        'previewRequest.objective',
        `${operation} is outside the preview-only authority boundary`,
      );
    }
  }
  return objective;
}

export function normalizePreviewRequest(input: unknown): DelegationPreviewRequest {
  const record = parseRecord(input, 'previewRequest', [
    'objective',
    'requestedBy',
    'previewedAt',
    'planRevision',
    'planTtlMs',
    'maxConcurrency',
    'budget',
  ]);
  const previewedAt = parseBoundedString(record.previewedAt, 'previewRequest.previewedAt', 64);
  if (!RFC3339_PATTERN.test(previewedAt) || !Number.isFinite(Date.parse(previewedAt))) {
    fail('previewRequest.previewedAt', 'must be a valid RFC 3339 date-time');
  }
  const budgetRecord = parseRecord(record.budget, 'previewRequest.budget', [
    'maxCostMicrodollars',
    'maxTokens',
    'maxDurationMs',
  ]);

  return {
    objective: parseObjective(record.objective),
    requestedBy: parseStableId(record.requestedBy, 'previewRequest.requestedBy'),
    previewedAt,
    planRevision: parseSafeInteger(
      record.planRevision,
      'previewRequest.planRevision',
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    planTtlMs: parseSafeInteger(
      record.planTtlMs,
      'previewRequest.planTtlMs',
      1_000,
      MAX_PLAN_TTL_MS,
    ),
    maxConcurrency: parseSafeInteger(record.maxConcurrency, 'previewRequest.maxConcurrency', 1, 3),
    budget: {
      maxCostMicrodollars: parseSafeInteger(
        budgetRecord.maxCostMicrodollars,
        'previewRequest.budget.maxCostMicrodollars',
        0,
        MAX_PREVIEW_COST_MICRODOLLARS,
      ),
      maxTokens: parseSafeInteger(
        budgetRecord.maxTokens,
        'previewRequest.budget.maxTokens',
        PHASE_COUNT,
        MAX_PREVIEW_TOKENS,
      ),
      maxDurationMs: parseSafeInteger(
        budgetRecord.maxDurationMs,
        'previewRequest.budget.maxDurationMs',
        PHASE_COUNT,
        MAX_PLAN_TTL_MS,
      ),
    },
  };
}

export function normalizePreviewRegistry(input: unknown): NormalizedPreviewRegistry {
  const record = parseRecord(input, 'previewRegistry', ['snapshotId', 'candidates', 'evidence']);
  const candidates = parseArray(
    record.candidates,
    'previewRegistry.candidates',
    MAX_REGISTRY_CANDIDATES,
    1,
  ).map((candidate, index) => parseCandidate(candidate, `previewRegistry.candidates[${index}]`));
  const candidateKeys = candidates.map((entry) => tupleKey(entry.candidate));
  if (new Set(candidateKeys).size !== candidateKeys.length) {
    fail('previewRegistry.candidates', 'must not contain duplicate versioned tuples');
  }

  const evidence = parseArray(
    record.evidence,
    'previewRegistry.evidence',
    MAX_EVIDENCE_FIXTURES,
  ).map((fixture, index) => parseEvidence(fixture, `previewRegistry.evidence[${index}]`));
  const knownCandidates = new Set(candidateKeys);
  const evidenceKeys = new Set<string>();
  for (const [index, fixture] of evidence.entries()) {
    const candidateKey = tupleKey(fixture.candidate);
    if (!knownCandidates.has(candidateKey)) {
      fail(
        `previewRegistry.evidence[${index}].candidate`,
        'does not exist in this registry snapshot',
      );
    }
    const evidenceKey = JSON.stringify([candidateKey, fixture.capabilityId]);
    if (evidenceKeys.has(evidenceKey)) {
      fail('previewRegistry.evidence', 'must not duplicate candidate capability evidence');
    }
    evidenceKeys.add(evidenceKey);
  }

  return {
    snapshotId: parseStableId(record.snapshotId, 'previewRegistry.snapshotId', 'registry'),
    candidates,
    evidence,
  };
}

export function routingTupleKey(candidate: RoutingCandidate): string {
  return tupleKey(candidate);
}
