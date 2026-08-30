import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { TOOLS, EXTRA_AI_DIRS } from './registry.mjs';

function dirStats(path, maxFiles = 200000) {
  let files = 0, bytes = 0, last = 0;
  const stack = [path];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!e.isFile()) continue;
      files++;
      if (files > maxFiles) return { files, bytes, last, truncated: true };
      try {
        const s = statSync(p);
        bytes += s.size;
        if (s.mtimeMs > last) last = s.mtimeMs;
      } catch {}
    }
  }
  return { files, bytes, last, truncated: false };
}

export function onPath(cli) {
  if (!cli || typeof cli !== 'string') return null;
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${cli}` : `which ${cli}`;
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

export function scanTools() {
  const home = homedir();
  const found = [];
  for (const t of TOOLS) {
    const dirPath = t.dir ? join(home, t.dir) : null;
    const hasDir = dirPath && existsSync(dirPath);
    const cliPath = onPath(t.cli);
    if (!hasDir && !cliPath) continue;
    const stats = hasDir ? dirStats(dirPath) : { files: 0, bytes: 0, last: 0 };
    found.push({
      ...t,
      installed: true,
      cliPath,
      dataFiles: stats.files,
      dataMB: Math.round(stats.bytes / 1048576),
      lastActivity: stats.last ? new Date(stats.last).toISOString() : null,
      daysSinceUse: stats.last ? Math.floor((Date.now() - stats.last) / 86400000) : null,
    });
  }
  
  const dormant = [];
  for (const d of EXTRA_AI_DIRS) {
    const p = join(home, d);
    if (!existsSync(p)) continue;
    const stats = dirStats(p, 5000);
    dormant.push({ dir: d, files: stats.files, mb: Math.round(stats.bytes / 1048576) });
  }
  return { tools: found, dormant };
}
