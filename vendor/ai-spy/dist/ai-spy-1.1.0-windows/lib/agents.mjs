import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describeModel } from './model-catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CFG = join(ROOT, 'config', 'agents.json');

const OLLAMA = join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');
const LMS = join(homedir(), '.lmstudio', 'bin', 'lms.exe');

// Seed registry — the launch commands are explicit and user-editable in config/agents.json.
function seed() {
  return {
    agents: [
      {
        id: 'claude', name: 'Claude', runtime: 'claude-cli', role: 'orchestrator',
        endpoint: null, port: null,
        description: 'Orchestrator. Plans multi-step work, routes each step to the best local agent, and synthesizes the result. Also answers directly.',
        launch: null, activeModel: 'claude (cli default)', models: {},
      },
      {
        id: 'ollama', name: 'Ollama', runtime: 'ollama',
        endpoint: 'http://127.0.0.1:11434', chatPath: '/v1/chat/completions', port: 11434,
        description: 'Local model server. Fast startup, CLI-driven, great for coding and general tasks that should stay on-device.',
        launch: { cmd: OLLAMA, args: ['serve'] },
        activeModel: null, models: {},
      },
      {
        id: 'lmstudio', name: 'LM Studio', runtime: 'lmstudio',
        endpoint: 'http://127.0.0.1:1234', chatPath: '/v1/chat/completions', port: 1234,
        description: 'Local model host with a big downloaded library. Good for reasoning models, vision, and niche/domain models.',
        launch: { cmd: LMS, args: ['server', 'start'] },
        activeModel: null, models: {},
      },
    ],
  };
}

export function loadAgents() {
  if (!existsSync(CFG)) { mkdirSync(dirname(CFG), { recursive: true }); writeFileSync(CFG, JSON.stringify(seed(), null, 2)); }
  try { return JSON.parse(readFileSync(CFG, 'utf8')); } catch { return seed(); }
}

export function saveAgents(reg) {
  mkdirSync(dirname(CFG), { recursive: true });
  writeFileSync(CFG, JSON.stringify(reg, null, 2));
}

/* ---------- discovery ---------- */

async function ollamaModels(ep) {
  try {
    const [tags, ps] = await Promise.all([
      fetch(ep + '/api/tags', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null),
      fetch(ep + '/api/ps', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null),
    ]);
    if (!tags) return { running: false, installed: [], loaded: [] };
    return {
      running: true,
      installed: (tags.models || []).map(m => ({ id: m.name, sizeGB: +(m.size / 1073741824).toFixed(1), params: m.details?.parameter_size })),
      loaded: (ps?.models || []).map(m => m.name),
    };
  } catch { return { running: false, installed: [], loaded: [] }; }
}

async function lmstudioModels(ep) {
  try {
    const r = await fetch(ep + '/v1/models', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { running: false, installed: [], loaded: [] };
    const j = await r.json();
    const installed = (j.data || []).map(m => ({ id: m.id }));
    // lms ps -> which are actually resident in memory
    let loaded = [];
    try {
      const p = spawnSync(LMS, ['ps'], { encoding: 'utf8', timeout: 6000 });
      loaded = (p.stdout || '').split(/\r?\n/).map(l => l.trim().split(/\s+/)[0]).filter(x => x && !/^(LLM|EMBEDDING|PARAMS|You|Identifier)/i.test(x));
    } catch {}
    return { running: true, installed, loaded };
  } catch { return { running: false, installed: [], loaded: [] }; }
}

// Ensure every discovered model has a config entry on its agent (auto-configure).
export async function buildAgentState() {
  const reg = loadAgents();
  let changed = false;

  for (const a of reg.agents) {
    if (a.runtime === 'ollama' || a.runtime === 'lmstudio') {
      const disc = a.runtime === 'ollama' ? await ollamaModels(a.endpoint) : await lmstudioModels(a.endpoint);
      a._running = disc.running;
      a._loaded = disc.loaded;
      a._installed = disc.installed.map(m => m.id);
      a._sizes = Object.fromEntries(disc.installed.map(m => [m.id, m.sizeGB]));
      // auto-config: add any installed model missing from config
      for (const m of disc.installed) {
        if (!a.models[m.id]) { a.models[m.id] = describeModel(m.id); changed = true; }
      }
      // active model = first loaded, else persisted, else first installed
      if (disc.loaded.length) a.activeModel = disc.loaded[0];
      else if (!a.activeModel && disc.installed.length) a.activeModel = disc.installed[0].id;
    }
  }
  if (changed) saveAgents(reg);
  return reg;
}

// list of every routable (non-embedding) model across agents, for the picker + orchestrator
export function routableModels(reg) {
  const out = [];
  for (const a of reg.agents) {
    if (a.runtime === 'claude-cli') { out.push({ agentId: a.id, agentName: a.name, model: 'sonnet', role: 'general', description: 'Claude default via CLI', endpoint: 'cli' }); continue; }
    for (const [id, cfg] of Object.entries(a.models || {})) {
      if (cfg.role === 'embedding') continue;
      out.push({ agentId: a.id, agentName: a.name, model: id, role: cfg.role, description: cfg.description, endpoint: a.endpoint, sizeGB: a._sizes?.[id], running: a._running, loaded: (a._loaded || []).includes(id) });
    }
  }
  return out;
}
