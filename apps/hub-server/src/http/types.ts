import type { Server } from 'node:http';

import type { DelegationPreviewRegistry } from '../types.js';

export type AgentEvidenceProvenance =
  'VERIFIED_HOST_INVENTORY' | 'DOCUMENTED_COMPATIBILITY' | 'BENCHMARK_RESULT';

export interface ServerOwnedAgentEvidence {
  readonly agentManifestId: string;
  readonly provenance: AgentEvidenceProvenance;
  readonly observedAt: string;
  readonly summary: string;
}

export interface ServerOwnedAgentRegistry {
  readonly delegationRegistry: DelegationPreviewRegistry;
  readonly agentEvidence: readonly ServerOwnedAgentEvidence[];
}

export type AgentConnectionState = 'READY' | 'DEGRADED' | 'OFFLINE' | 'UNSUPPORTED';

export type AgentStatusCode =
  | 'AVAILABLE'
  | 'AUTHENTICATED'
  | 'CONNECTED'
  | 'DESKTOP_ONLY'
  | 'UNAVAILABLE'
  | 'PROBE_TIMEOUT'
  | 'PROBE_FAILED';

export interface AgentRuntimeStatus {
  readonly id: 'hermes' | 'codex' | 'claude-code' | 'openclaw' | 'antigravity';
  readonly state: AgentConnectionState;
  readonly statusCode: AgentStatusCode;
  readonly version: string | null;
}

export interface AgentStatusSnapshot {
  readonly schemaVersion: 1;
  readonly mode: 'READ_ONLY';
  readonly observedAt: string;
  readonly agents: readonly AgentRuntimeStatus[];
}

export type AgentStatusProvider = () => Promise<AgentStatusSnapshot>;

export interface HubRequestHandlerOptions {
  readonly staticDirectory?: string;
  readonly clock?: () => Date;
  readonly agentRegistry?: ServerOwnedAgentRegistry;
  readonly agentStatusProvider?: AgentStatusProvider;
}

export interface HubServerOptions extends HubRequestHandlerOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface StartedHubServer {
  readonly server: Server;
  readonly url: URL;
}
