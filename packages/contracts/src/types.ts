export interface DelegationAuthority {
  readonly workspaceGrantIds: readonly string[];
  readonly toolGrantIds: readonly string[];
  readonly networkGrantIds: readonly string[];
  readonly credentialGrantIds: readonly string[];
  readonly externalActionGrantIds: readonly string[];
}

export interface DelegationBudget {
  readonly maxCostMicrodollars: number;
  readonly maxTokens: number;
  readonly maxDurationMs: number;
}

export interface DelegationIntent {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly objective: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly authority: DelegationAuthority;
  readonly budget: DelegationBudget;
}

export interface DelegationWorkItem {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly dependsOn: readonly string[];
  readonly parentWorkItemId?: string;
  readonly requiredCapabilities: readonly string[];
  readonly authority: DelegationAuthority;
  readonly budget: DelegationBudget;
  readonly attemptLimit: number;
  readonly handoffLimit: number;
}

export interface DelegationPlan {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly intentId: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly authority: DelegationAuthority;
  readonly budget: DelegationBudget;
  readonly maxConcurrency: number;
  readonly workItems: readonly DelegationWorkItem[];
}

/**
 * Authorization context required when accepting a delegation plan. Keeping the
 * intent beside the plan prevents a structurally valid plan from silently
 * widening the user's original authority or budget.
 */
export interface DelegationPlanValidationContext {
  readonly intent: DelegationIntent;
}

/**
 * These three identifiers intentionally remain separate fields. An agent
 * runtime, an inference model, and a tool grant can change independently.
 */
export interface RoutingCandidate {
  readonly agentProfileId: string;
  readonly modelProfileId: string;
  readonly toolProfileId: string;
}

export interface RoutingAssignment {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly planFingerprint: string;
  readonly registrySnapshotId: string;
  readonly workItemId: string;
  readonly expiresAt: string;
  readonly candidate: RoutingCandidate;
  readonly selectionReasons: readonly string[];
  readonly alternatives: readonly RoutingCandidate[];
  readonly expectedCostMicrodollars: number;
  readonly confidence: number;
  readonly requiredApprovals: readonly string[];
}

export interface RoutingCandidateEligibility {
  readonly candidate: RoutingCandidate;
  readonly requiredToolGrantIds: readonly string[];
  readonly requiredApprovalIds: readonly string[];
}

export interface RoutingAssignmentValidationContextInput {
  readonly plan: DelegationPlan;
  readonly planRevision: number;
  readonly registrySnapshotId: string;
  readonly eligibleCandidates: readonly RoutingCandidateEligibility[];
}

declare const routingAssignmentValidationContextBrand: unique symbol;

export interface RoutingAssignmentValidationContext {
  readonly [routingAssignmentValidationContextBrand]: true;
  readonly plan: DelegationPlan;
  readonly planRevision: number;
  readonly planFingerprint: string;
  readonly registrySnapshotId: string;
  readonly eligibleCandidates: readonly RoutingCandidateEligibility[];
}

export type AgentRuntimeLocation = 'TABLET' | 'WINDOWS_HOST';

export type AgentAvailabilityProbeKind = 'HTTP';

export interface AgentAvailabilityProbe {
  readonly kind: AgentAvailabilityProbeKind;
  readonly url: string;
  readonly timeoutMs: number;
}

export type AgentLaunchMode = 'INTERACTIVE' | 'REMOTE_CONTROL' | 'DELEGATED';

export type AgentCapabilitySupport = 'NATIVE' | 'BRIDGED' | 'UNSUPPORTED';

export type AgentCapabilityLevel = 'BASIC' | 'STRONG' | 'EXPERT';

export type AgentCapabilityRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AgentCapabilityDeclaration {
  readonly capabilityId: string;
  readonly support: AgentCapabilitySupport;
  readonly declaredLevel: AgentCapabilityLevel;
  readonly requiredToolProfileIds: readonly string[];
  readonly maximumRisk: AgentCapabilityRisk;
}

export type AgentHandoffType = 'task' | 'review' | 'artifact';

export type AgentLifecycleState = 'ACTIVE' | 'PAUSED' | 'RETIRED';

/**
 * A declarative description of an agent adapter. Availability probes are data,
 * never executable commands, so loading a manifest cannot grant code execution.
 */
export interface AgentManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly version: string;
  readonly runtimeLocation: AgentRuntimeLocation;
  readonly adapterId: string;
  readonly availabilityProbe: AgentAvailabilityProbe;
  readonly launchModes: readonly AgentLaunchMode[];
  readonly capabilities: readonly AgentCapabilityDeclaration[];
  readonly bestFor: readonly string[];
  readonly doNotUseFor: readonly string[];
  readonly requiredApprovals: readonly string[];
  readonly supportedHandoffTypes: readonly AgentHandoffType[];
  readonly lifecycleState: AgentLifecycleState;
}

export type OpenRouterAuditionMode = 'RAW_MODEL_AUDITION' | 'SANDBOX_AGENT_AUDITION';

export interface OpenRouterAuditionLimits {
  /** Integer microdollars avoid floating-point settlement errors. */
  readonly maxCostMicrodollars: number;
  readonly maxTokens: number;
  readonly maxDurationMs: number;
}

/**
 * A request to audition one OpenRouter model. The fixed provider origin and
 * credential alias are injected by the trusted host after parsing and are
 * deliberately absent from this caller-controlled contract.
 */
export interface OpenRouterAuditionRequest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly mode: OpenRouterAuditionMode;
  readonly candidate: RoutingCandidate;
  readonly prompt: string;
  /**
   * Per-request bounds only. The host must additionally reserve and settle
   * costs against server-owned daily and monthly ledgers before dispatch.
   */
  readonly limits: OpenRouterAuditionLimits;
}

export type BenchmarkType = 'RAW_MODEL' | 'AGENT_HARNESS' | 'FULL_WORKFLOW';

export type BenchmarkEvidenceField =
  'FIXTURE_SHA256' | 'PROMPT_HASH' | 'ENVIRONMENT_HASH' | 'ARTIFACT_REFS' | 'POLICY_VIOLATIONS';

export type BenchmarkOutcomeField =
  | 'COMPLETION_STATUS'
  | 'QUALITY_SCORE'
  | 'COST_MICRODOLLARS'
  | 'TOKEN_USAGE'
  | 'LATENCY_MS'
  | 'CRITICAL_SAFETY_FAILURES';

export interface BenchmarkRun {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly benchmarkType: BenchmarkType;
  readonly fixtureId: string;
  readonly taskCategoryId: string;
  readonly repetitions: number;
  readonly candidates: readonly RoutingCandidate[];
  readonly evidenceFields: readonly BenchmarkEvidenceField[];
  readonly outcomeFields: readonly BenchmarkOutcomeField[];
}

export interface PendingPromotionApproval {
  readonly status: 'PENDING';
}

export interface ApprovedPromotionApproval {
  readonly status: 'APPROVED';
  readonly approvalId: string;
  readonly evidenceId: string;
  readonly candidate: RoutingCandidate;
  readonly taskCategoryId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export type PromotionUserApproval = PendingPromotionApproval | ApprovedPromotionApproval;

export interface PromotionEvidence {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly candidate: RoutingCandidate;
  readonly taskCategoryId: string;
  readonly benchmarkRunIds: readonly string[];
  readonly distinctCaseCount: number;
  readonly minimumRepetitionsPerCase: number;
  readonly criticalSafetyFailureCount: number;
  readonly qualityGatePassed: boolean;
}

declare const trustedPromotionEvidenceBrand: unique symbol;
declare const trustedPromotionApprovalBrand: unique symbol;

export interface TrustedPromotionEvidence extends PromotionEvidence {
  readonly [trustedPromotionEvidenceBrand]: true;
}

export type TrustedPromotionUserApproval = PromotionUserApproval & {
  readonly [trustedPromotionApprovalBrand]: true;
};

export interface PromotionEligibilityContext {
  readonly evidence: TrustedPromotionEvidence;
  readonly userApproval: TrustedPromotionUserApproval;
}

export type PromotionEligibilityGate =
  | 'DISTINCT_CASE_COUNT'
  | 'REPETITIONS_PER_CASE'
  | 'CRITICAL_SAFETY_FAILURES'
  | 'EVIDENCE_RECENCY'
  | 'APPROVAL_RECENCY'
  | 'QUALITY_GATE'
  | 'VERSION_BINDING'
  | 'USER_APPROVAL';

export interface PromotionEligibilityDecision {
  readonly eligible: boolean;
  readonly failedGates: readonly PromotionEligibilityGate[];
}
