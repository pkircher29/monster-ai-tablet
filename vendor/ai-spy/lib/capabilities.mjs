import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { hermesInventory } from './hermes.mjs';

const HOME = homedir();
const safeJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const safeDirs = (p) => {
  try {
    return readdirSync(p).filter(n => { try { return statSync(join(p, n)).isDirectory(); } catch { return false; } });
  } catch { return []; }
};
const safeFiles = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } catch { return []; } };

/* ---------- inventories per harness ---------- */

function claudeInventory() {
  const base = join(HOME, '.claude');
  if (!existsSync(base)) return null;

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
        for (const kind of ['skills', 'agents', 'commands', 'hooks']) {
          if (existsSync(join(path, kind))) provides.push(kind);
        }
        if (!provides.includes('hooks') && existsSync(join(path, 'src', 'hooks'))) provides.push('hooks');
        if (existsSync(join(path, '.mcp.json')) || existsSync(join(path, 'mcp.json'))) provides.push('mcp');
      }
      plugins.push({ name, marketplace, version: e?.version, installedAt: e?.installedAt, provides });
    }
  }

  const mcp = new Map();
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
  const skillsDir = join(base, 'antigravity-cli', 'builtin', 'skills');
  const skills = existsSync(skillsDir) ? safeDirs(skillsDir) : [];
  return {
    mcpServers: Object.keys(settings.mcpServers || {}).map(name => ({ name, scopes: ['global'] })),
    skills,
    extensions: safeDirs(join(base, 'extensions')),
  };
}

function opencodeInventory() {
  const base = join(HOME, '.opencode');
  if (!existsSync(base)) return null;
  const skills = safeDirs(join(base, 'skills'));
  return {
    installed: true,
    skills
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

/* ---------- cross-harness gap & sharing recommendations ---------- */

function analyze(inv, usage) {
  const recs = [];
  const staleDays = (u) => u?.lastUsed ? Math.floor((Date.now() - new Date(u.lastUsed)) / 86400000) : null;

  // Cross-harness skill sharing recommendations
  if (inv.hermes?.skills?.length && inv.claude) {
    const claudeSkillSet = new Set(inv.claude.skills || []);
    for (const hs of inv.hermes.skills) {
      if (!claudeSkillSet.has(hs.name)) {
        recs.push({
          kind: 'share',
          severity: 'medium',
          text: `Hermes skill "${hs.name}" available — can be transmuted and shared to Claude Code / Gemini.`,
          exec: { verb: 'deploy', source: 'hermes', target: 'claude', skill: hs.name }
        });
      }
    }
  }

  if (inv.claude?.skills?.length && inv.hermes) {
    const hermesSkillSet = new Set(inv.hermes.skills.map(s => s.name));
    for (const cs of inv.claude.skills) {
      if (!hermesSkillSet.has(cs)) {
        recs.push({
          kind: 'share',
          severity: 'medium',
          text: `Claude skill "${cs}" available — can be transmuted and shared to Hermes / Gemini.`,
          exec: { verb: 'deploy', source: 'claude', target: 'hermes', skill: cs }
        });
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
    if (u?.count >= 3 && owners.length === 1) {
      const targets = ['codex', 'gemini', 'claude'].filter(t => inv[t] && !owners.includes(t));
      if (targets.length) {
        recs.push({
          kind: 'share',
          severity: 'medium',
          text: `MCP server "${name}" configured in ${owners.join(', ')} only — portable; can deploy to ${targets.join(' + ')}.`
        });
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => order[a.severity] - order[b.severity]);
  return recs;
}

export function buildCapabilities() {
  const inv = {
    claude: claudeInventory(),
    codex: codexInventory(),
    gemini: geminiInventory(),
    hermes: hermesInventory(),
    opencode: opencodeInventory()
  };
  const usage = claudeUsage();
  const recommendations = analyze(inv, usage);
  return { generatedAt: new Date().toISOString(), inventories: inv, usage, recommendations };
}
