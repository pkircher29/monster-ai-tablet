import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const HERMES_DIR = join(HOME, '.hermes');

const safeJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const safeDirs = (p) => {
  try {
    return readdirSync(p).filter(n => {
      if (n.startsWith('.')) return false;
      try { return statSync(join(p, n)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
};
const safeFiles = (p) => {
  try {
    return readdirSync(p).filter(n => {
      if (n.startsWith('.')) return false;
      try { return statSync(join(p, n)).isFile(); } catch { return false; }
    });
  } catch { return []; }
};

export function getHermesGatewayState() {
  const p = join(HERMES_DIR, 'gateway_state.json');
  if (!existsSync(p)) return { running: false, status: 'stopped' };
  const data = safeJSON(p);
  if (!data) return { running: false, status: 'stopped' };
  return {
    running: data.gateway_state === 'running',
    status: data.gateway_state || 'unknown',
    pid: data.pid,
    version: data.code_version,
    updatedAt: data.updated_at,
    platforms: data.platforms || {}
  };
}

export function hermesInventory() {
  if (!existsSync(HERMES_DIR)) return null;

  const skillsDir = join(HERMES_DIR, 'skills');
  const skills = safeDirs(skillsDir).map(name => {
    const sDir = join(skillsDir, name);
    let description = '';
    const skillMd = join(sDir, 'SKILL.md');
    if (existsSync(skillMd)) {
      try {
        const txt = readFileSync(skillMd, 'utf8');
        const m = txt.match(/description:\s*([^\r\n]+)/i) || txt.match(/#\s*([^\r\n]+)/);
        if (m) description = m[1].replace(/^["']|["']$/g, '').trim();
      } catch {}
    }
    return { name, description, path: sDir };
  });

  const profilesDir = join(HERMES_DIR, 'profiles');
  const profiles = safeDirs(profilesDir);

  const soulPath = join(HERMES_DIR, 'SOUL.md');
  const hasSoul = existsSync(soulPath);
  let soulSnippet = '';
  if (hasSoul) {
    try {
      soulSnippet = readFileSync(soulPath, 'utf8').slice(0, 300);
    } catch {}
  }

  const hooksDir = join(HERMES_DIR, 'hooks');
  const hooks = safeFiles(hooksDir);

  const cronDir = join(HERMES_DIR, 'cron');
  const cronJobs = safeFiles(cronDir);

  const gateway = getHermesGatewayState();

  return {
    installed: true,
    version: gateway.version || '0.20.x',
    gateway,
    skills,
    skillCount: skills.length,
    profiles,
    hasSoul,
    soulSnippet,
    hooks,
    cronJobs
  };
}

export function hermesUsage() {
  if (!existsSync(HERMES_DIR)) return null;

  let totalSizeMB = 0;
  let lastActivity = null;
  const sessionsDir = join(HERMES_DIR, 'sessions');
  const logsDir = join(HERMES_DIR, 'logs');
  const stateDb = join(HERMES_DIR, 'state.db');

  let sessionCount = 0;
  if (existsSync(sessionsDir)) {
    const files = safeFiles(sessionsDir);
    sessionCount = files.length;
  }

  let dbSizeMB = 0;
  if (existsSync(stateDb)) {
    try {
      const s = statSync(stateDb);
      dbSizeMB = Math.round(s.size / (1024 * 1024));
      if (s.mtimeMs > (lastActivity || 0)) lastActivity = s.mtimeMs;
    } catch {}
  }

  const gateway = getHermesGatewayState();

  return {
    harness: 'hermes',
    installed: true,
    active: gateway.running,
    gatewayPid: gateway.pid,
    sessions: sessionCount,
    stateDbMB: dbSizeMB,
    lastActivity: lastActivity ? new Date(lastActivity).toISOString() : new Date().toISOString(),
    daysSinceUse: 0
  };
}
