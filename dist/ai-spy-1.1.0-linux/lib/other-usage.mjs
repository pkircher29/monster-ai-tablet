import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

function walkFiles(path) {
  const out = [];
  const stack = [path];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { const s = statSync(p); out.push({ path: p, size: s.size, mtimeMs: s.mtimeMs }); } catch {} }
    }
  }
  return out;
}

export function analyzeCodex() {
  const dir = join(homedir(), '.codex', 'sessions');
  if (!existsSync(dir)) return null;
  const files = walkFiles(dir);
  const byMonth = {};
  for (const f of files) {
    const m = new Date(f.mtimeMs).toISOString().slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  }
  const last = files.reduce((a, f) => Math.max(a, f.mtimeMs), 0);
  return { sessions: files.length, byMonth,
    sizeMB: Math.round(files.reduce((a, f) => a + f.size, 0) / 1048576),
    lastActivity: last ? new Date(last).toISOString() : null };
}

export function analyzeOllama() {
  try {
    const out = execSync('ollama list', { encoding: 'utf8', timeout: 15000 });
    const models = out.split(/\r?\n/).slice(1).filter(Boolean).map(l => {
      const parts = l.trim().split(/\s{2,}/);
      return { name: parts[0], size: parts[2], modified: parts[3] };
    });
    return { models, count: models.length };
  } catch { return null; }
}

export function analyzeLMStudio() {
  const dir = join(homedir(), '.lmstudio', 'models');
  if (!existsSync(dir)) return null;
  const models = [];
  try {
    for (const pub of readdirSync(dir)) {
      const pubDir = join(dir, pub);
      let subs;
      try { subs = readdirSync(pubDir); } catch { continue; }
      for (const m of subs) {
        const files = walkFiles(join(pubDir, m));
        models.push({
          name: `${pub}/${m}`,
          sizeGB: +(files.reduce((a, f) => a + f.size, 0) / 1073741824).toFixed(1),
          lastUsed: new Date(files.reduce((a, f) => Math.max(a, f.mtimeMs), 0)).toISOString().slice(0, 10),
        });
      }
    }
  } catch {}
  return { models: models.sort((a, b) => b.sizeGB - a.sizeGB), totalGB: +models.reduce((a, m) => a + m.sizeGB, 0).toFixed(0) };
}

export function analyzeGemini() {
  const dir = join(homedir(), '.gemini');
  if (!existsSync(dir)) return null;
  const histDir = join(dir, 'history');
  let sessions = 0, last = 0;
  if (existsSync(histDir)) {
    const files = walkFiles(histDir);
    sessions = files.length;
    last = files.reduce((a, f) => Math.max(a, f.mtimeMs), 0);
  }
  const tmpDir = join(dir, 'tmp');
  if (existsSync(tmpDir)) {
    const files = walkFiles(tmpDir);
    last = Math.max(last, files.reduce((a, f) => Math.max(a, f.mtimeMs), 0));
  }
  return { sessions, lastActivity: last ? new Date(last).toISOString() : null };
}
