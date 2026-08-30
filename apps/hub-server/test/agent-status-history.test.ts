import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createAgentStatusHistoryStore,
  withAgentStatusHistory,
  type AgentStatusSnapshot,
} from '../dist/index.js';

function snapshot(observedAt: string, codexVersion = '0.150.1'): AgentStatusSnapshot {
  return {
    schemaVersion: 1,
    mode: 'READ_ONLY',
    observedAt,
    agents: [
      { id: 'hermes', state: 'READY', statusCode: 'AVAILABLE', version: '0.20.5' },
      { id: 'codex', state: 'READY', statusCode: 'AUTHENTICATED', version: codexVersion },
      {
        id: 'claude-code',
        state: 'READY',
        statusCode: 'AUTHENTICATED',
        version: '2.1.251',
      },
      { id: 'openclaw', state: 'READY', statusCode: 'AVAILABLE', version: '2026.7.1-2' },
      { id: 'antigravity', state: 'UNSUPPORTED', statusCode: 'DESKTOP_ONLY', version: null },
    ],
  };
}

test('persists only bounded closed snapshots and survives reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'monster-agent-status-'));
  const databasePath = join(directory, 'status.sqlite');
  try {
    const store = createAgentStatusHistoryStore({ databasePath, maxSnapshots: 2 });
    store.record(snapshot('2026-08-30T08:00:00.000Z'));
    store.record(snapshot('2026-08-30T08:01:00.000Z'));
    store.record(snapshot('2026-08-30T08:02:00.000Z', '0.151.0'));

    const reopened = createAgentStatusHistoryStore({ databasePath, maxSnapshots: 2 });
    const recent = reopened.readRecent(10);
    assert.deepEqual(
      recent.map((entry) => entry.observedAt),
      ['2026-08-30T08:02:00.000Z', '2026-08-30T08:01:00.000Z'],
    );
    assert.equal(recent[0]?.agents.find((agent) => agent.id === 'codex')?.version, '0.151.0');
    assert.ok(recent.every((entry) => Object.isFrozen(entry)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects non-closed or inconsistent status records before opening SQLite', () => {
  const invalid = {
    ...snapshot('2026-08-30T08:00:00.000Z'),
    rawProbeOutput: 'private@example.invalid --token secret',
  };
  assert.throws(
    () => createAgentStatusHistoryStore({ databasePath: ':memory:' }).record(invalid),
    /closed agent status snapshot/,
  );
});

test('records every successful live provider result before returning it', async () => {
  const recorded: AgentStatusSnapshot[] = [];
  const expected = snapshot('2026-08-30T08:00:00.000Z');
  const provider = withAgentStatusHistory(async () => expected, {
    record(value) {
      recorded.push(value);
    },
    readRecent() {
      return [];
    },
  });

  assert.equal(await provider(), expected);
  assert.deepEqual(recorded, [expected]);
});
