import type { AgentStatusProvider } from '../http/types.js';

export type AgentProbeId =
  | 'hermes.version'
  | 'hermes.gateway'
  | 'codex.version'
  | 'codex.auth'
  | 'claude.version'
  | 'claude.auth'
  | 'openclaw.gateway';

export interface AgentProbeCommand {
  readonly probeId: AgentProbeId;
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface AgentProbeResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export interface AgentProbeRunner {
  run(command: AgentProbeCommand): Promise<AgentProbeResult>;
}

export interface LiveAgentStatusProviderOptions {
  readonly runner: AgentProbeRunner;
  readonly clock?: () => Date;
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly nodeExecutable?: string;
}

export type LiveAgentStatusProvider = AgentStatusProvider;
