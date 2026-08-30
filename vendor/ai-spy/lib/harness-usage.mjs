import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { hermesUsage } from './hermes.mjs';

const HOME = homedir();
const walk = (dir, ext) => {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && p.endsWith(ext)) out.push(p);
    }
  }
  return out;
};

// Codex sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
function codexUsage() {
  const dir = join(HOME, '.codex', 'sessions');
  if (!existsSync(dir)) return null;
  const files = walk(dir, '.jsonl');
  const byMonth = {}, byProject = {}, providers = {};
  let turns = 0, tokens = 0, last = 0, first = null;
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const mtime = statSync(f).mtimeMs;
    if (mtime > last) last = mtime;
    const month = new Date(mtime).toISOString().slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const p = rec.payload || {};
      if (rec.type === 'session_meta') {
        if (p.model_provider) providers[p.model_provider] = (providers[p.model_provider] || 0) + 1;
        const proj = (p.cwd || '').split(/[\\/]/).pop();
        if (proj) byProject[proj] = (byProject[proj] || 0) + 1;
        if (p.timestamp && (!first || p.timestamp < first)) first = p.timestamp;
      }
      if (rec.type === 'event_msg' && /task_started/.test(p.type || '')) turns++;
      const u = p.usage || p.token_usage || p.info?.usage;
      if (u) tokens += (u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0) || 0);
    }
  }
  return {
    harness: 'codex',
    sessions: files.length, turns, tokens: tokens || null, providers, byMonth,
    byProject: Object.fromEntries(Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 8)),
    firstActivity: first, lastActivity: last ? new Date(last).toISOString() : null,
    tokenNote: tokens ? null : 'Codex rollout logs do not record token counts locally'
  };
}

// Antigravity (Gemini) transcripts
function antigravityUsage() {
  const base = join(HOME, '.gemini', 'antigravity-cli', 'brain');
  if (!existsSync(base)) return null;
  const sessions = [];
  try {
    const entries = readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const logFile = join(base, e.name, '.system_generated', 'logs', 'transcript.jsonl');
        if (existsSync(logFile)) sessions.push(logFile);
      }
    }
  } catch {}

  let turns = 0, last = 0;
  for (const s of sessions) {
    try {
      const mtime = statSync(s).mtimeMs;
      if (mtime > last) last = mtime;
      const text = readFileSync(s, 'utf8');
      turns += text.split('\n').filter(l => l.includes('"type":"USER_INPUT"')).length;
    } catch {}
  }

  return {
    harness: 'gemini',
    sessions: sessions.length,
    turns,
    lastActivity: last ? new Date(last).toISOString() : null,
    installed: true
  };
}

export function buildHarnessUsage() {
  return {
    codex: codexUsage(),
    antigravity: antigravityUsage(),
    hermes: hermesUsage(),
  };
}
