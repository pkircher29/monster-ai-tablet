import { mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type {
  AgentConnectionState,
  AgentRuntimeStatus,
  AgentStatusCode,
  AgentStatusProvider,
  AgentStatusSnapshot,
} from '../http/types.js';

const AGENT_IDS = ['hermes', 'codex', 'claude-code', 'openclaw', 'antigravity'] as const;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const MAX_HISTORY_LIMIT = 256;

export interface AgentStatusHistoryStore {
  record(snapshot: AgentStatusSnapshot): void;
  readRecent(limit: number): readonly AgentStatusSnapshot[];
}

export interface AgentStatusHistoryStoreOptions {
  readonly databasePath: string;
  readonly maxSnapshots?: number;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertClosedSnapshot(value: unknown): asserts value is AgentStatusSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'mode', 'observedAt', 'agents']) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'READ_ONLY' ||
    !isCanonicalTimestamp(value.observedAt) ||
    !Array.isArray(value.agents) ||
    value.agents.length !== AGENT_IDS.length
  ) {
    throw new TypeError('Expected a closed agent status snapshot.');
  }

  const expectedState: Readonly<Record<AgentStatusCode, AgentConnectionState>> = {
    AVAILABLE: 'READY',
    AUTHENTICATED: 'READY',
    CONNECTED: 'READY',
    DESKTOP_ONLY: 'UNSUPPORTED',
    UNAVAILABLE: 'OFFLINE',
    PROBE_TIMEOUT: 'DEGRADED',
    PROBE_FAILED: 'DEGRADED',
  };
  const remainingIds = new Set<string>(AGENT_IDS);
  for (const agent of value.agents) {
    if (
      !isRecord(agent) ||
      !hasExactKeys(agent, ['id', 'state', 'statusCode', 'version']) ||
      typeof agent.id !== 'string' ||
      !remainingIds.delete(agent.id) ||
      typeof agent.statusCode !== 'string' ||
      !Object.hasOwn(expectedState, agent.statusCode) ||
      expectedState[agent.statusCode as AgentStatusCode] !== agent.state ||
      (agent.version !== null &&
        (typeof agent.version !== 'string' || !SAFE_VERSION.test(agent.version)))
    ) {
      throw new TypeError('Expected a closed agent status snapshot.');
    }
  }
}

function boundedPositiveInteger(value: unknown, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1 || (resolved as number) > 256) {
    throw new TypeError('Agent status history limit must be an integer from 1 through 256.');
  }
  return resolved as number;
}

function validateDatabasePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.includes('\0') ||
    (value !== ':memory:' && !isAbsolute(value))
  ) {
    throw new TypeError('Agent status database path must be absolute.');
  }
  return value;
}

function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS status_snapshots (
      observed_at TEXT PRIMARY KEY NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_status_history (
      observed_at TEXT NOT NULL REFERENCES status_snapshots(observed_at) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
      agent_id TEXT NOT NULL,
      state TEXT NOT NULL,
      status_code TEXT NOT NULL,
      version TEXT,
      PRIMARY KEY (observed_at, agent_id)
    ) STRICT;
  `);
  return database;
}

function frozenSnapshot(
  observedAt: string,
  agents: readonly AgentRuntimeStatus[],
): AgentStatusSnapshot {
  const frozenAgents = Object.freeze(agents.map((agent) => Object.freeze({ ...agent })));
  return Object.freeze({ schemaVersion: 1, mode: 'READ_ONLY', observedAt, agents: frozenAgents });
}

export function createAgentStatusHistoryStore(
  options: AgentStatusHistoryStoreOptions,
): AgentStatusHistoryStore {
  const databasePath = validateDatabasePath(options.databasePath);
  const maxSnapshots = boundedPositiveInteger(options.maxSnapshots, MAX_HISTORY_LIMIT);

  return Object.freeze({
    record(snapshot: AgentStatusSnapshot): void {
      assertClosedSnapshot(snapshot);
      const database = openDatabase(databasePath);
      try {
        database.exec('BEGIN IMMEDIATE');
        database
          .prepare('INSERT OR REPLACE INTO status_snapshots (observed_at) VALUES (?)')
          .run(snapshot.observedAt);
        const insert = database.prepare(`
          INSERT INTO agent_status_history
            (observed_at, position, agent_id, state, status_code, version)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        snapshot.agents.forEach((agent, position) => {
          insert.run(
            snapshot.observedAt,
            position,
            agent.id,
            agent.state,
            agent.statusCode,
            agent.version,
          );
        });
        database
          .prepare(
            `
            DELETE FROM status_snapshots
            WHERE observed_at NOT IN (
              SELECT observed_at FROM status_snapshots ORDER BY observed_at DESC LIMIT ?
            )
          `,
          )
          .run(maxSnapshots);
        database.exec('COMMIT');
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // Preserve the original storage error.
        }
        throw error;
      } finally {
        database.close();
      }
    },

    readRecent(limit: number): readonly AgentStatusSnapshot[] {
      const boundedLimit = boundedPositiveInteger(limit, maxSnapshots);
      const database = openDatabase(databasePath);
      try {
        const rows = database
          .prepare(
            `
            SELECT observed_at, agent_id, state, status_code, version
            FROM agent_status_history
            WHERE observed_at IN (
              SELECT observed_at FROM status_snapshots ORDER BY observed_at DESC LIMIT ?
            )
            ORDER BY observed_at DESC, position ASC
          `,
          )
          .all(boundedLimit) as Array<Record<string, SQLInputValue>>;
        const grouped = new Map<string, AgentRuntimeStatus[]>();
        for (const row of rows) {
          const observedAt = String(row.observed_at);
          const agents = grouped.get(observedAt) ?? [];
          agents.push({
            id: String(row.agent_id) as AgentRuntimeStatus['id'],
            state: String(row.state) as AgentConnectionState,
            statusCode: String(row.status_code) as AgentStatusCode,
            version: row.version === null ? null : String(row.version),
          });
          grouped.set(observedAt, agents);
        }
        return Object.freeze(
          [...grouped].map(([observedAt, agents]) => frozenSnapshot(observedAt, agents)),
        );
      } finally {
        database.close();
      }
    },
  });
}

export function defaultAgentStatusDatabasePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform() === 'win32') {
    return join(
      environment.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'MonsterAgentHub',
      'agent-status.sqlite',
    );
  }
  return join(
    environment.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
    'monster-agent-hub',
    'agent-status.sqlite',
  );
}

export function withAgentStatusHistory(
  provider: AgentStatusProvider,
  store: AgentStatusHistoryStore,
): AgentStatusProvider {
  return async () => {
    const snapshot = await provider();
    store.record(snapshot);
    return snapshot;
  };
}
