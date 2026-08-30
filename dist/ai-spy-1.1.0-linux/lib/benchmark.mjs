import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentState } from './agents.mjs';
import { launch, setModel } from './control.mjs';

const STORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'benchmarks.json');
const PROMPT = 'Write a haiku about the ocean.'; // fixed, small, deterministic-ish workload

function load() { try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return {}; } }
function save(db) { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify(db, null, 2)); }

export function listBenchmarks() { return load(); }

// stream a chat completion, timing first token and total; estimate tok/s from chunk count
async function benchOne(endpoint, model, timeout = 180000) {
  const started = Date.now();
  const r = await fetch(endpoint + '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], stream: true, max_tokens: 120, temperature: 0.5 }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let ttft = null, chunks = 0, buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttft === null) ttft = Date.now() - started;
    buf += dec.decode(value, { stream: true });
    // count SSE data chunks carrying content deltas as a token proxy
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (line.startsWith('data:') && line.includes('"content"') && !line.includes('[DONE]')) chunks++;
    }
  }
  const totalMs = Date.now() - started;
  const genMs = Math.max(1, totalMs - (ttft || 0));
  return {
    ttftMs: ttft ?? totalMs,
    tokens: chunks,
    tokPerSec: +(chunks / (genMs / 1000)).toFixed(1),
    totalMs,
    ranAt: new Date().toISOString(),
  };
}

export async function benchmark(agentId, model) {
  const reg = await buildAgentState();
  const a = reg.agents.find(x => x.id === agentId);
  if (!a || (a.runtime !== 'ollama' && a.runtime !== 'lmstudio')) return { ok: false, error: 'not a local agent' };
  if (!a._running) { const l = await launch(agentId); if (!l.ok) return { ok: false, error: 'agent offline' }; }
  if (a.runtime === 'lmstudio' && !(a._loaded || []).includes(model)) await setModel(agentId, model).catch(() => {});
  try {
    const res = await benchOne(a.endpoint, model);
    const db = load();
    db[`${agentId}::${model}`] = { agentId, model, ...res };
    save(db);
    return { ok: true, agentId, model, ...res };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}

// bench every installed local model, sequentially (heavy — used by the "bench all" job)
export async function benchmarkAll({ onEvent = () => {} } = {}) {
  const reg = await buildAgentState();
  const jobs = [];
  for (const a of reg.agents) {
    if (a.runtime !== 'ollama' && a.runtime !== 'lmstudio') continue;
    for (const [m, cfg] of Object.entries(a.models || {})) if (cfg.role !== 'embedding') jobs.push({ agentId: a.id, model: m });
  }
  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    onEvent({ type: 'bench-start', index: i, total: jobs.length, ...jobs[i] });
    const r = await benchmark(jobs[i].agentId, jobs[i].model);
    results.push(r);
    onEvent({ type: 'bench-done', index: i, ...r });
  }
  return { ok: true, results };
}
