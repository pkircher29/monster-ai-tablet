import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

// Codex sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, lines {timestamp,type,payload}
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
      // best-effort token capture from any payload carrying usage
      const u = p.usage || p.token_usage || p.info?.usage;
      if (u) tokens += (u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0) || 0);
    }
  }
  return { sessions: files.length, turns, tokens: tokens || null, providers, byMonth,
    byProject: Object.fromEntries(Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 8)),
    firstActivity: first, lastActivity: last ? new Date(last).toISOString() : null,
    tokenNote: tokens ? null : 'Codex rollout logs do not record token counts locally' };
}

// Antigravity (Gemini) transcripts: ~/.gemini/antigravity/<agent>/<uuid>/.system_generated/logs/transcript_full.jsonl
function antigravityUsage() {
  const base = join(HOME, '.gemini', 'antigravity');
  if (!existsSync(base)) return null;
  const files = walk(base, 'transcript_full.jsonl');
  let turns = 0, last = 0, first = null;
  const sessions = new Set();
  for (const f of files) {
    sessions.add(f);
    const mtime = statSync(f).mtimeMs;
    if (mtime > last) last = mtime;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('USER_INPUT')) continue;
      turns++;
      try { const r = JSON.parse(line); if (r.created_at && (!first || r.created_at < first)) first = r.created_at; } catch {}
    }
  }
  return { sessions: sessions.size, turns, firstActivity: first,
    lastActivity: last ? new Date(last).toISOString() : null,
    tokenNote: 'Antigravity transcripts do not record token counts locally' };
}

export function buildHarnessUsage() {
  return { generatedAt: new Date().toISOString(), codex: codexUsage(), antigravity: antigravityUsage() };
}
