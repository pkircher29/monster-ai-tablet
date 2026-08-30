import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const safeJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// statSync follows symlinks/junctions — dirent.isDirectory() is false for linked dirs (common for installed skills)
const safeDirs = (p) => {
  try {
    return readdirSync(p).filter(n => { try { return statSync(join(p, n)).isDirectory(); } catch { return false; } });
  } catch { return []; }
};
const safeFiles = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } catch { return []; } };

/* ---------- inventories per harness ---------- */

function claudeInventory() {
  const base = join(HOME, '.claude');
  const skills = safeDirs(join(base, 'skills'));
  const agents = safeFiles(join(base, 'agents')).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
  const commands = safeFiles(join(base, 'commands')).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));

  const plugins = [];
  const installed = safeJSON(join(base, 'plugins', 'installed_plugins.json'));
  if (installed?.plugins) {
    for (const [key, entries] of Object.entries(installed.plugins)) {
      const [name, marketplace] = key.split('@');
      const e = Array.isArray(entries) ? entries[0] : entries;
      const path = e?.installPath;
      const provides = [];
      if (path) {
        // version dir may nest content under itself directly
        for (const kind of ['skills', 'agents', 'commands', 'hooks']) {
          if (existsSync(join(path, kind))) provides.push(kind);
        }
        if (!provides.includes('hooks') && existsSync(join(path, 'src', 'hooks'))) provides.push('hooks');
        if (existsSync(join(path, '.mcp.json')) || existsSync(join(path, 'mcp.json'))) provides.push('mcp');
      }
      plugins.push({ name, marketplace, version: e?.version, installedAt: e?.installedAt, provides });
    }
  } else {
    // fallback: walk the cache
    const cache = join(base, 'plugins', 'cache');
    for (const mp of safeDirs(cache)) for (const p of safeDirs(join(cache, mp))) {
      plugins.push({ name: p, marketplace: mp, version: null, installedAt: null, provides: [] });
    }
  }

  // MCP servers: top-level + union of per-project entries in ~/.claude.json
  const mcp = new Map(); // name -> {scopes:[...]}
  const cj = safeJSON(join(HOME, '.claude.json'));
  if (cj) {
    for (const name of Object.keys(cj.mcpServers || {})) {
      if (name) mcp.set(name, { name, scopes: ['global'] });
    }
    for (const [proj, cfg] of Object.entries(cj.projects || {})) {
      for (const name of Object.keys(cfg?.mcpServers || {})) {
        if (!name) continue;
        if (!mcp.has(name)) mcp.set(name, { name, scopes: [] });
        mcp.get(name).scopes.push(proj.split(/[\\/]/).pop() || proj);
      }
    }
  }
  return { skills, agents, commands, plugins, mcpServers: [...mcp.values()] };
}

function codexInventory() {
  const p = join(HOME, '.codex', 'config.toml');
  if (!existsSync(p)) return null;
  const toml = readFileSync(p, 'utf8');
  const plugins = [];
  const re = /\[plugins\."([^"]+)"\]([^[]*)/g;
  let m;
  while ((m = re.exec(toml))) {
    const [name, marketplace] = m[1].split('@');
    const enabled = !/enabled\s*=\s*false/.test(m[2]);
    plugins.push({ name, marketplace, enabled });
  }
  const mcpServers = [...toml.matchAll(/\[mcp_servers\.([A-Za-z0-9_-]+)\]/g)].map(x => ({ name: x[1], scopes: ['global'] }));
  const prompts = safeFiles(join(HOME, '.codex', 'prompts')).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
  return { plugins, mcpServers, prompts };
}

function geminiInventory() {
  const base = join(HOME, '.gemini');
  if (!existsSync(base)) return null;
  const settings = safeJSON(join(base, 'settings.json')) || {};
  return {
    mcpServers: Object.keys(settings.mcpServers || {}).map(name => ({ name, scopes: ['global'] })),
    extensions: safeDirs(join(base, 'extensions')),
  };
}

/* ---------- real usage from Claude Code transcripts ---------- */

function claudeUsage() {
  const projDir = join(HOME, '.claude', 'projects');
  const usage = { mcp: {}, skills: {}, agents: {}, plugins: {} };
  const bump = (map, key, ts) => {
    if (!key) return;
    if (!map[key]) map[key] = { count: 0, lastUsed: null };
    map[key].count++;
    if (ts && (!map[key].lastUsed || ts > map[key].lastUsed)) map[key].lastUsed = ts;
  };
  const seen = new Set();
  if (!existsSync(projDir)) return usage;
  for (const proj of safeDirs(projDir)) {
    for (const f of safeFiles(join(projDir, proj)).filter(x => x.endsWith('.jsonl'))) {
      let text;
      try { text = readFileSync(join(projDir, proj, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"tool_use"')) continue;
        let rec; try { rec = JSON.parse(line); } catch { continue; }
        const content = rec?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type !== 'tool_use' || !block.name) continue;
          if (block.id && seen.has(block.id)) continue;
          if (block.id) seen.add(block.id);
          const ts = rec.timestamp || null;
          if (block.name.startsWith('mcp__')) {
            const server = block.name.split('__')[1];
            // plugin-provided servers look like plugin_<plugin>_<server>
            const pm = server?.match(/^plugin_(.+?)_/);
            if (pm) bump(usage.plugins, pm[1], ts);
            bump(usage.mcp, server, ts);
          } else if (block.name === 'Skill') {
            const skill = block.input?.skill;
            bump(usage.skills, skill, ts);
            if (skill?.includes(':')) bump(usage.plugins, skill.split(':')[0], ts);
          } else if (block.name === 'Agent' || block.name === 'Task') {
            bump(usage.agents, block.input?.subagent_type || 'general-purpose', ts);
          }
        }
      }
    }
  }
  return usage;
}

/* ---------- gap + staleness analysis ---------- */

function analyze(inv, usage) {
  const recs = [];
  const staleDays = (u) => u?.lastUsed ? Math.floor((Date.now() - new Date(u.lastUsed)) / 86400000) : null;

  // plugin parity between Claude Code and Codex (same marketplace format)
  if (inv.codex) {
    const cSet = new Set(inv.claude.plugins.map(p => p.name));
    const xSet = new Set(inv.codex.plugins.filter(p => p.enabled).map(p => p.name));
    for (const p of inv.claude.plugins) {
      if (xSet.has(p.name)) continue;
      const u = usage.plugins[p.name];
      if (u?.count) recs.push({ kind: 'share', severity: 'high', text: `Plugin "${p.name}" used ${u.count}x in Claude Code but missing from Codex — install it there (same marketplace format).` });
    }
    for (const p of inv.codex.plugins.filter(p => p.enabled)) {
      if (!cSet.has(p.name) && p.marketplace === 'claude-plugins-official') {
        // enable is reversible + whitelisted; only works if installed-but-disabled, else surfaces error
        recs.push({ kind: 'share', severity: 'low', text: `Plugin "${p.name}" enabled in Codex but not in Claude Code — try enabling it in Claude.`,
          exec: { verb: 'enable', target: p.name, label: `enable "${p.name}" in Claude` } });
      }
    }
  }

  // MCP server parity
  const mcpOwners = {};
  for (const [h, i] of Object.entries(inv)) {
    for (const s of (i?.mcpServers || [])) (mcpOwners[s.name] ||= []).push(h);
  }
  for (const [name, owners] of Object.entries(mcpOwners)) {
    const u = usage.mcp[name];
    if (u?.count >= 3 && owners.length === 1 && owners[0] === 'claude') {
      const targets = ['codex', 'gemini'].filter(t => inv[t]);
      if (targets.length) recs.push({ kind: 'share', severity: 'medium', text: `MCP server "${name}" used ${u.count}x in Claude Code only — MCP is portable; add to ${targets.join(' + ')}.` });
    }
  }

  // staleness: installed capability never/long unused
  for (const p of inv.claude.plugins) {
    const u = usage.plugins[p.name];
    const d = staleDays(u);
    if (!u?.count) {
      // hook-driven plugins fire outside the Skill/MCP tool surface — usage is invisible here
      if (p.provides.includes('hooks')) recs.push({ kind: 'audit', severity: 'low', text: `Plugin "${p.name}" (Claude Code): hook-driven, usage not measurable from transcripts — judge manually.` });
      else recs.push({ kind: 'remove', severity: 'medium', text: `Plugin "${p.name}" (Claude Code): zero recorded invocations — removal candidate.`,
        exec: { verb: 'disable', target: p.name, label: `disable "${p.name}" in Claude` } });
    } else if (d > 45) recs.push({ kind: 'remove', severity: 'low', text: `Plugin "${p.name}" (Claude Code): unused ${d} days.`,
      exec: { verb: 'disable', target: p.name, label: `disable "${p.name}" in Claude` } });
  }
  const skillGroups = {};
  for (const s of inv.claude.skills) skillGroups[s.split('-')[0]] = (skillGroups[s.split('-')[0]] || 0) + 1;
  for (const [group, n] of Object.entries(skillGroups)) {
    const used = Object.keys(usage.skills).filter(k => k.startsWith(group)).reduce((a, k) => a + usage.skills[k].count, 0);
    if (!used && n > 1) recs.push({ kind: 'remove', severity: 'medium', text: `Skill pack "${group}-*" (${n} skills, Claude Code): zero invocations — removal candidate.` });
  }
  for (const s of (inv.codex?.mcpServers || [])) {
    recs.push({ kind: 'audit', severity: 'low', text: `Codex MCP server "${s.name}": usage not trackable from here — check codex sessions if still needed.` });
  }
  const order = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => order[a.severity] - order[b.severity]);
  return recs;
}

export function buildCapabilities() {
  const inv = { claude: claudeInventory(), codex: codexInventory(), gemini: geminiInventory() };
  const usage = claudeUsage();
  const recommendations = analyze(inv, usage);
  return { generatedAt: new Date().toISOString(), inventories: inv, usage, recommendations };
}
