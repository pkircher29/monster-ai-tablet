import { join } from 'node:path';

import type { AgentProbeCommand, LiveAgentStatusProviderOptions } from './types.js';

const PROBE_TIMEOUT_MS = 8_000;
const MAX_PROBE_OUTPUT_BYTES = 32 * 1_024;

function command(
  probeId: AgentProbeCommand['probeId'],
  executable: string,
  args: readonly string[],
): AgentProbeCommand {
  return Object.freeze({
    probeId,
    executable,
    args: Object.freeze([...args]),
    timeoutMs: PROBE_TIMEOUT_MS,
    maxOutputBytes: MAX_PROBE_OUTPUT_BYTES,
  });
}

export function createAgentProbeCommands(
  options: LiveAgentStatusProviderOptions,
): readonly AgentProbeCommand[] {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  if (platform !== 'win32') {
    return Object.freeze([
      command('hermes.version', 'hermes', ['--version']),
      command('hermes.gateway', 'hermes', ['gateway', 'status']),
      command('codex.version', 'codex', ['--version']),
      command('codex.auth', 'codex', ['login', 'status']),
      command('claude.version', 'claude', ['--version']),
      command('claude.auth', 'claude', ['auth', 'status', '--json']),
      command('openclaw.gateway', 'openclaw', ['gateway', 'status', '--json', '--no-probe']),
    ]);
  }

  const userProfile = environment.USERPROFILE ?? '';
  const appData = environment.APPDATA ?? '';
  const hermesExecutable = join(userProfile, '.hermes', 'hermes-agent', 'bin', 'hermes.exe');
  const claudeExecutable = join(userProfile, '.local', 'bin', 'claude.exe');
  const codexEntrypoint = join(
    appData,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  const openClawEntrypoint = join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');

  return Object.freeze([
    command('hermes.version', hermesExecutable, ['--version']),
    command('hermes.gateway', hermesExecutable, ['gateway', 'status']),
    command('codex.version', nodeExecutable, [codexEntrypoint, '--version']),
    command('codex.auth', nodeExecutable, [codexEntrypoint, 'login', 'status']),
    command('claude.version', claudeExecutable, ['--version']),
    command('claude.auth', claudeExecutable, ['auth', 'status', '--json']),
    command('openclaw.gateway', nodeExecutable, [
      openClawEntrypoint,
      'gateway',
      'status',
      '--json',
      '--no-probe',
    ]),
  ]);
}
