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

export interface HubRequestHandlerOptions {
  readonly staticDirectory?: string;
  readonly clock?: () => Date;
  readonly agentRegistry?: ServerOwnedAgentRegistry;
}

export interface HubServerOptions extends HubRequestHandlerOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface StartedHubServer {
  readonly server: Server;
  readonly url: URL;
}
