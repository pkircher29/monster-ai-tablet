import type { AgentRuntimeStatus, AgentStatusCode } from '../http/types.js';
import { createAgentProbeCommands } from './commands.js';
import type {
  AgentProbeId,
  AgentProbeResult,
  LiveAgentStatusProvider,
  LiveAgentStatusProviderOptions,
} from './types.js';

const SAFE_VERSION = /^[0-9][0-9A-Za-z.-]{0,63}$/;

function versionFrom(output: string, pattern: RegExp): string | null {
  const candidate = pattern.exec(output)?.[1] ?? '';
  return SAFE_VERSION.test(candidate) ? candidate : null;
}

function failedStatus(
  id: AgentRuntimeStatus['id'],
  result: AgentProbeResult,
  version: string | null = null,
): AgentRuntimeStatus {
  let statusCode: AgentStatusCode = 'UNAVAILABLE';
  let state: AgentRuntimeStatus['state'] = 'OFFLINE';
  if (result.timedOut) {
    statusCode = 'PROBE_TIMEOUT';
    state = 'DEGRADED';
  } else if (result.truncated || (result.exitCode === 0 && version === null)) {
    statusCode = 'PROBE_FAILED';
    state = 'DEGRADED';
  }
  return { id, state, statusCode, version };
}

function parseJsonRecord(output: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(output);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createLiveAgentStatusProvider(
  options: LiveAgentStatusProviderOptions,
): LiveAgentStatusProvider {
  const commands = createAgentProbeCommands(options);
  const clock = options.clock ?? (() => new Date());

  return async () => {
    const settled = await Promise.all(
      commands.map(async (command) => {
        try {
          return [command.probeId, await options.runner.run(command)] as const;
        } catch {
          return [
            command.probeId,
            { exitCode: null, stdout: '', stderr: '', timedOut: false, truncated: false },
          ] as const;
        }
      }),
    );
    const results = new Map<AgentProbeId, AgentProbeResult>(settled);
    const get = (probeId: AgentProbeId) => results.get(probeId)!;

    const hermesVersion = versionFrom(get('hermes.version').stdout, /Hermes Agent v([^\s]+)/);
    const hermesGateway = get('hermes.gateway');
    const hermes =
      hermesVersion === null || get('hermes.version').exitCode !== 0
        ? failedStatus('hermes', get('hermes.version'), hermesVersion)
        : hermesGateway.exitCode === 0 && /gateway process running/i.test(hermesGateway.stdout)
          ? ({
              id: 'hermes',
              state: 'READY',
              statusCode: 'AVAILABLE',
              version: hermesVersion,
            } as const)
          : failedStatus('hermes', hermesGateway, hermesVersion);

    const codexVersion = versionFrom(get('codex.version').stdout, /codex-cli\s+([^\s]+)/);
    const codexAuth = get('codex.auth');
    const codexAuthOutput = `${codexAuth.stdout}\n${codexAuth.stderr}`;
    const codex =
      codexVersion === null || get('codex.version').exitCode !== 0
        ? failedStatus('codex', get('codex.version'), codexVersion)
        : codexAuth.exitCode === 0 && /logged in/i.test(codexAuthOutput)
          ? ({
              id: 'codex',
              state: 'READY',
              statusCode: 'AUTHENTICATED',
              version: codexVersion,
            } as const)
          : failedStatus('codex', codexAuth, codexVersion);

    const claudeVersion = versionFrom(get('claude.version').stdout, /^([^\s]+)\s+\(Claude Code\)/);
    const claudeAuth = get('claude.auth');
    const claudeAuthJson = parseJsonRecord(claudeAuth.stdout);
    const claude =
      claudeVersion === null || get('claude.version').exitCode !== 0
        ? failedStatus('claude-code', get('claude.version'), claudeVersion)
        : claudeAuth.exitCode === 0 && claudeAuthJson?.loggedIn === true
          ? ({
              id: 'claude-code',
              state: 'READY',
              statusCode: 'AUTHENTICATED',
              version: claudeVersion,
            } as const)
          : failedStatus('claude-code', claudeAuth, claudeVersion);

    const openClawResult = get('openclaw.gateway');
    const openClawJson = parseJsonRecord(openClawResult.stdout);
    const openClawVersion = versionFrom(
      String(nestedRecord(openClawJson ?? {}, 'cli')?.version ?? ''),
      /^([^\s]+)$/,
    );
    const openClawHealthy = nestedRecord(openClawJson ?? {}, 'health')?.healthy === true;
    const openClawRunning =
      nestedRecord(nestedRecord(openClawJson ?? {}, 'service') ?? {}, 'runtime')?.status ===
      'running';
    const openClaw =
      openClawResult.exitCode === 0 &&
      openClawVersion !== null &&
      openClawHealthy &&
      openClawRunning
        ? ({
            id: 'openclaw',
            state: 'READY',
            statusCode: 'AVAILABLE',
            version: openClawVersion,
          } as const)
        : failedStatus('openclaw', openClawResult, openClawVersion);

    return {
      schemaVersion: 1,
      mode: 'READ_ONLY',
      observedAt: clock().toISOString(),
      agents: [
        hermes,
        codex,
        claude,
        openClaw,
        {
          id: 'antigravity',
          state: 'UNSUPPORTED',
          statusCode: 'DESKTOP_ONLY',
          version: null,
        },
      ],
    };
  };
}
