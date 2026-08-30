import type { CandidateRegistryEntry, DelegationPreviewRegistry } from '../types.js';
import type { ServerOwnedAgentEvidence, ServerOwnedAgentRegistry } from './types.js';

const SAFE_TOOL_PROFILE_BASE_ID = 'safe-preview-tools';
const SAFE_TOOL_PROFILE_ID = `${SAFE_TOOL_PROFILE_BASE_ID}@1.0.0`;

type CapabilityLevel = 'BASIC' | 'STRONG' | 'EXPERT';
type CapabilitySupport = 'NATIVE' | 'BRIDGED';

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function capability(
  capabilityId: string,
  declaredLevel: CapabilityLevel,
  support: CapabilitySupport = 'NATIVE',
) {
  return {
    capabilityId,
    support,
    declaredLevel,
    requiredToolProfileIds: [SAFE_TOOL_PROFILE_BASE_ID],
    maximumRisk: 'MEDIUM' as const,
  };
}

function candidate(
  manifest: CandidateRegistryEntry['manifest'],
  modelProfileId: string,
  availability: CandidateRegistryEntry['availability'] = 'AVAILABLE',
): CandidateRegistryEntry {
  return {
    manifest,
    availability,
    modelProfileId,
    toolProfileId: SAFE_TOOL_PROFILE_ID,
    requiredToolGrantIds: ['tool.read-file'],
    requiredApprovalIds: [],
    expectedCostMicrodollars: 0,
  };
}

function createDelegationRegistry(): DelegationPreviewRegistry {
  const candidates: CandidateRegistryEntry[] = [
    candidate(
      {
        schemaVersion: 1,
        id: 'hermes',
        displayName: 'Hermes',
        summary: 'Host-installed Hermes agent exposed only through preview-safe routing.',
        version: '0.20.5',
        runtimeLocation: 'WINDOWS_HOST',
        adapterId: 'adapter.hermes',
        availabilityProbe: {
          kind: 'HTTP',
          url: 'http://127.0.0.1:9119/health',
          timeoutMs: 500,
        },
        launchModes: ['DELEGATED'],
        capabilities: [capability('research', 'STRONG')],
        bestFor: ['Research and bounded task decomposition.'],
        doNotUseFor: ['Native Android execution guarantees.'],
        requiredApprovals: ['approval.preview-review'],
        supportedHandoffTypes: ['task', 'artifact'],
        lifecycleState: 'ACTIVE',
      },
      'local/hermes-default@host-configured-1',
    ),
    candidate(
      {
        schemaVersion: 1,
        id: 'codex',
        displayName: 'Codex',
        summary: 'Windows-host Codex coding agent with preview-only authority in this registry.',
        version: '0.150.1',
        runtimeLocation: 'WINDOWS_HOST',
        adapterId: 'adapter.codex',
        availabilityProbe: {
          kind: 'HTTP',
          url: 'http://127.0.0.1:18790/codex/health',
          timeoutMs: 500,
        },
        launchModes: ['REMOTE_CONTROL', 'DELEGATED'],
        capabilities: [
          capability('implementation', 'EXPERT'),
          capability('verification', 'EXPERT'),
          capability('review', 'STRONG'),
        ],
        bestFor: ['Implementation, testing, and codebase repair.'],
        doNotUseFor: ['Native execution inside Android Termux.'],
        requiredApprovals: ['approval.preview-review'],
        supportedHandoffTypes: ['task', 'review', 'artifact'],
        lifecycleState: 'ACTIVE',
      },
      'openai/codex-default@host-configured-1',
    ),
    candidate(
      {
        schemaVersion: 1,
        id: 'claude-code',
        displayName: 'Claude Code',
        summary: 'Windows-host Claude Code agent represented as a reviewable routing option.',
        version: '2.1.251',
        runtimeLocation: 'WINDOWS_HOST',
        adapterId: 'adapter.claude-code',
        availabilityProbe: {
          kind: 'HTTP',
          url: 'http://127.0.0.1:18790/claude-code/health',
          timeoutMs: 500,
        },
        launchModes: ['REMOTE_CONTROL', 'DELEGATED'],
        capabilities: [
          capability('implementation', 'STRONG'),
          capability('verification', 'STRONG'),
          capability('review', 'EXPERT'),
        ],
        bestFor: ['Review, analysis, and alternative implementation proposals.'],
        doNotUseFor: ['Native execution inside Android Termux.'],
        requiredApprovals: ['approval.preview-review'],
        supportedHandoffTypes: ['task', 'review', 'artifact'],
        lifecycleState: 'ACTIVE',
      },
      'anthropic/claude-default@host-configured-1',
    ),
    candidate(
      {
        schemaVersion: 1,
        id: 'openclaw',
        displayName: 'OpenClaw',
        summary: 'Local OpenClaw Gateway represented without granting Gateway control authority.',
        version: '2026.7.1-2',
        runtimeLocation: 'WINDOWS_HOST',
        adapterId: 'adapter.openclaw',
        availabilityProbe: {
          kind: 'HTTP',
          url: 'http://127.0.0.1:18789/health',
          timeoutMs: 500,
        },
        launchModes: ['REMOTE_CONTROL'],
        capabilities: [
          capability('research', 'BASIC', 'BRIDGED'),
          capability('review', 'BASIC', 'BRIDGED'),
        ],
        bestFor: ['Gateway-mediated operator and companion workflows.'],
        doNotUseFor: ['Direct coding delegation without a separately approved adapter.'],
        requiredApprovals: ['approval.preview-review'],
        supportedHandoffTypes: ['task', 'artifact'],
        lifecycleState: 'ACTIVE',
      },
      'local/openclaw-gateway@2026.7.1-2',
    ),
    candidate(
      {
        schemaVersion: 1,
        id: 'antigravity',
        displayName: 'Antigravity',
        summary:
          'Desktop Antigravity installation retained as unavailable until its bridge is repaired.',
        version: '2.9.1',
        runtimeLocation: 'WINDOWS_HOST',
        adapterId: 'adapter.antigravity',
        availabilityProbe: {
          kind: 'HTTP',
          url: 'http://127.0.0.1:18790/antigravity/health',
          timeoutMs: 500,
        },
        launchModes: ['INTERACTIVE'],
        capabilities: [capability('implementation', 'STRONG'), capability('review', 'STRONG')],
        bestFor: ['Interactive desktop coding after bridge verification.'],
        doNotUseFor: ['Delegated work while the remote tunnel is unavailable.'],
        requiredApprovals: ['approval.preview-review'],
        supportedHandoffTypes: ['artifact'],
        lifecycleState: 'PAUSED',
      },
      'google/antigravity-default@host-configured-1',
      'UNAVAILABLE',
    ),
  ];

  return {
    snapshotId: 'registry.host-default.2026-08-30.1',
    candidates,
    // Benchmark scores stay empty until the benchmark lab produces real runs.
    evidence: [],
  };
}

function createAgentEvidence(): ServerOwnedAgentEvidence[] {
  return [
    {
      agentManifestId: 'hermes',
      provenance: 'VERIFIED_HOST_INVENTORY',
      observedAt: '2026-08-30',
      summary: 'Hermes 0.20.5 was found on the Windows host; Android support remains best-effort.',
    },
    {
      agentManifestId: 'codex',
      provenance: 'VERIFIED_HOST_INVENTORY',
      observedAt: '2026-08-30',
      summary: 'Codex 0.150.1 was found on the Windows host; the tablet uses a remote surface.',
    },
    {
      agentManifestId: 'claude-code',
      provenance: 'VERIFIED_HOST_INVENTORY',
      observedAt: '2026-08-30',
      summary: 'Claude Code 2.1.251 was found on the Windows host with remote-control support.',
    },
    {
      agentManifestId: 'openclaw',
      provenance: 'VERIFIED_HOST_INVENTORY',
      observedAt: '2026-08-30',
      summary: 'OpenClaw Gateway 2026.7.1-2 was locally healthy; no control scope is implied here.',
    },
    {
      agentManifestId: 'antigravity',
      provenance: 'VERIFIED_HOST_INVENTORY',
      observedAt: '2026-08-30',
      summary:
        'Antigravity 2.9.1 was found, while its delegated remote bridge remained unavailable.',
    },
  ];
}

export function createServerOwnedAgentRegistry(): ServerOwnedAgentRegistry {
  return deepFreeze({
    delegationRegistry: createDelegationRegistry(),
    agentEvidence: createAgentEvidence(),
  });
}
