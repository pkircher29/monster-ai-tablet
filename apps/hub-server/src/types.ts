import type {
  AgentManifest,
  DelegationBudget,
  DelegationIntent,
  DelegationPlan,
  RoutingAssignment,
  RoutingCandidate,
} from '@monster-agent-hub/contracts';

export type CandidateAvailability = 'AVAILABLE' | 'UNAVAILABLE';

/**
 * Registry data is supplied by a trusted host loader. `availability` is an
 * already-observed fixture: preview generation never executes the manifest's
 * HTTP probe.
 */
export interface CandidateRegistryEntry {
  readonly manifest: unknown;
  readonly availability: CandidateAvailability;
  readonly modelProfileId: string;
  readonly toolProfileId: string;
  readonly requiredToolGrantIds: readonly string[];
  readonly requiredApprovalIds: readonly string[];
  readonly expectedCostMicrodollars: number;
}

export interface RoutingEvidenceFixture {
  readonly candidate: RoutingCandidate;
  readonly capabilityId: string;
  readonly qualityScore: number;
  readonly caseCount: number;
  readonly criticalSafetyFailures: number;
}

export interface DelegationPreviewRegistry {
  readonly snapshotId: string;
  readonly candidates: readonly CandidateRegistryEntry[];
  readonly evidence: readonly RoutingEvidenceFixture[];
}

export interface DelegationPreviewRequest {
  readonly objective: string;
  readonly requestedBy: string;
  /** Caller-supplied time keeps repeated previews byte-for-byte deterministic. */
  readonly previewedAt: string;
  readonly planRevision: number;
  readonly planTtlMs: number;
  readonly maxConcurrency: number;
  readonly budget: DelegationBudget;
}

export interface DelegationReadiness {
  readonly completedWorkItemIds: readonly string[];
  readonly readyWorkItemIds: readonly string[];
  readonly blockedWorkItemIds: readonly string[];
}

export interface DelegationPreview {
  readonly mode: 'PREVIEW_ONLY';
  readonly intent: DelegationIntent;
  readonly plan: DelegationPlan;
  readonly planRevision: number;
  readonly planFingerprint: string;
  readonly registrySnapshotId: string;
  readonly assignments: readonly RoutingAssignment[];
  readonly estimatedTotalCostMicrodollars: number;
  readonly readiness: DelegationReadiness;
  readonly sideEffects: readonly never[];
}

export interface NormalizedRegistryCandidate {
  readonly manifest: AgentManifest;
  readonly availability: CandidateAvailability;
  readonly candidate: RoutingCandidate;
  readonly requiredToolGrantIds: readonly string[];
  readonly requiredApprovalIds: readonly string[];
  readonly expectedCostMicrodollars: number;
}

export interface NormalizedPreviewRegistry {
  readonly snapshotId: string;
  readonly candidates: readonly NormalizedRegistryCandidate[];
  readonly evidence: readonly RoutingEvidenceFixture[];
}
