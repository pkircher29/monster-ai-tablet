import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLiveAgentStatusProvider, runAgentProbeCommand } from '../dist/index.js';

const NOW = new Date('2026-08-30T08:00:00.000Z');

test('maps server-owned live probes to a closed status snapshot without leaking raw output', async () => {
  const seenCommands: Array<{
    probeId: string;
    executable: string;
    args: readonly string[];
    timeoutMs: number;
    maxOutputBytes: number;
  }> = [];
  const outputs = new Map<string, { exitCode: number; stdout: string; stderr?: string }>([
    [
      'hermes.version',
      { exitCode: 0, stdout: 'Hermes Agent v0.20.5 (2026.8.19) · upstream abc123' },
    ],
    [
      'hermes.gateway',
      {
        exitCode: 0,
        stdout: 'Gateway process running. private-profile-name must never leave the host.',
      },
    ],
    ['codex.version', { exitCode: 0, stdout: 'codex-cli 0.150.1' }],
    ['codex.auth', { exitCode: 0, stdout: '', stderr: 'Logged in using ChatGPT' }],
    ['claude.version', { exitCode: 0, stdout: '2.1.251 (Claude Code)' }],
    [
      'claude.auth',
      {
        exitCode: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          email: 'private@example.invalid',
          orgId: 'private-org-id',
          token: 'provider-secret-token',
        }),
      },
    ],
    [
      'openclaw.gateway',
      {
        exitCode: 0,
        stdout: JSON.stringify({
          cli: { version: '2026.7.1-2', entrypoint: 'C:\\private\\openclaw.mjs' },
          service: { runtime: { status: 'running', pid: 1234 } },
          health: { healthy: true },
          rpc: { error: 'private gateway detail' },
        }),
      },
    ],
  ]);

  const provider = createLiveAgentStatusProvider({
    clock: () => new Date(NOW),
    platform: 'win32',
    environment: {
      USERPROFILE: 'C:\\Users\\TestOperator',
      APPDATA: 'C:\\Users\\TestOperator\\AppData\\Roaming',
    },
    nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
    runner: {
      async run(command) {
        seenCommands.push(command);
        const output = outputs.get(command.probeId);
        assert.ok(output, command.probeId);
        return {
          ...output,
          stderr: output.stderr ?? '',
          timedOut: false,
          truncated: false,
        };
      },
    },
  });

  const snapshot = await provider();

  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    mode: 'READ_ONLY',
    observedAt: NOW.toISOString(),
    agents: [
      { id: 'hermes', state: 'READY', statusCode: 'AVAILABLE', version: '0.20.5' },
      { id: 'codex', state: 'READY', statusCode: 'AUTHENTICATED', version: '0.150.1' },
      {
        id: 'claude-code',
        state: 'READY',
        statusCode: 'AUTHENTICATED',
        version: '2.1.251',
      },
      { id: 'openclaw', state: 'READY', statusCode: 'AVAILABLE', version: '2026.7.1-2' },
      { id: 'antigravity', state: 'UNSUPPORTED', statusCode: 'DESKTOP_ONLY', version: null },
    ],
  });
  assert.deepEqual(
    seenCommands.map((command) => command.probeId),
    [
      'hermes.version',
      'hermes.gateway',
      'codex.version',
      'codex.auth',
      'claude.version',
      'claude.auth',
      'openclaw.gateway',
    ],
  );
  assert.ok(seenCommands.every((command) => command.timeoutMs <= 10_000));
  assert.ok(seenCommands.every((command) => command.maxOutputBytes <= 32 * 1_024));
  assert.ok(seenCommands.every((command) => command.executable.length > 0));
  assert.ok(seenCommands.every((command) => Object.isFrozen(command.args)));
  assert.doesNotMatch(
    JSON.stringify(snapshot).toLowerCase(),
    /private|email|orgid|token|pid|entrypoint|executable|command|stdout|stderr|path/,
  );
});

test('fails individual probes closed while preserving safe versions from successful probes', async () => {
  const provider = createLiveAgentStatusProvider({
    clock: () => new Date(NOW),
    platform: 'linux',
    environment: {},
    nodeExecutable: '/usr/bin/node',
    runner: {
      async run(command) {
        if (command.probeId === 'codex.version') {
          return {
            exitCode: 0,
            stdout: 'codex-cli 0.150.1',
            stderr: '',
            timedOut: false,
            truncated: false,
          };
        }
        if (command.probeId === 'codex.auth') {
          return {
            exitCode: null,
            stdout: '',
            stderr: 'sensitive timeout detail',
            timedOut: true,
            truncated: false,
          };
        }
        return {
          exitCode: 1,
          stdout: 'sensitive failure detail',
          stderr: 'sensitive failure detail',
          timedOut: false,
          truncated: command.probeId === 'openclaw.gateway',
        };
      },
    },
  });

  const snapshot = await provider();

  assert.deepEqual(snapshot.agents, [
    { id: 'hermes', state: 'OFFLINE', statusCode: 'UNAVAILABLE', version: null },
    { id: 'codex', state: 'DEGRADED', statusCode: 'PROBE_TIMEOUT', version: '0.150.1' },
    { id: 'claude-code', state: 'OFFLINE', statusCode: 'UNAVAILABLE', version: null },
    { id: 'openclaw', state: 'DEGRADED', statusCode: 'PROBE_FAILED', version: null },
    { id: 'antigravity', state: 'UNSUPPORTED', statusCode: 'DESKTOP_ONLY', version: null },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot).toLowerCase(), /sensitive|stdout|stderr/);
});

test('runs a probe without a shell and returns bounded output', async () => {
  const result = await runAgentProbeCommand({
    probeId: 'codex.version',
    executable: process.execPath,
    args: Object.freeze(['-e', "process.stdout.write('safe-version')"]),
    timeoutMs: 2_000,
    maxOutputBytes: 1_024,
  });

  assert.deepEqual(result, {
    exitCode: 0,
    stdout: 'safe-version',
    stderr: '',
    timedOut: false,
    truncated: false,
  });
});

test('terminates probes that exceed output or duration bounds', async () => {
  const oversized = await runAgentProbeCommand({
    probeId: 'codex.version',
    executable: process.execPath,
    args: Object.freeze([
      '-e',
      "process.stdout.write('x'.repeat(4096)); setInterval(() => undefined, 1000)",
    ]),
    timeoutMs: 2_000,
    maxOutputBytes: 512,
  });
  assert.equal(oversized.truncated, true);
  assert.equal(oversized.timedOut, false);
  assert.ok(Buffer.byteLength(oversized.stdout) <= 512);
  assert.equal(oversized.stderr, '');

  const timedOut = await runAgentProbeCommand({
    probeId: 'codex.version',
    executable: process.execPath,
    args: Object.freeze(['-e', 'setInterval(() => undefined, 1000)']),
    timeoutMs: 50,
    maxOutputBytes: 1_024,
  });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.truncated, false);
  assert.ok(Buffer.byteLength(timedOut.stdout) <= 1_024);
  assert.ok(Buffer.byteLength(timedOut.stderr) <= 1_024);
});
