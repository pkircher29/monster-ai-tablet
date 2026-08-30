#!/usr/bin/env node
// Agent OS web server — live dashboard over the same analyzers the CLI uses.
// Zero dependencies. `node server.mjs` then open http://localhost:4177
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces, hostname } from 'node:os';
import { buildSnapshot } from './lib/snapshot.mjs';
import { buildCapabilities } from './lib/capabilities.mjs';
import { buildNetwork } from './lib/network.mjs';
import { buildSubscriptionUsage } from './lib/subscriptions-usage.mjs';
import { buildAgentState, routableModels } from './lib/agents.mjs';
import { launch, restart, setModel, rename, describe } from './lib/control.mjs';
import { runOrchestration, planTask, executePlan, listRuns } from './lib/orchestrate.mjs';
import { benchmark, benchmarkAll, listBenchmarks } from './lib/benchmark.mjs';
import { buildHarnessUsage } from './lib/harness-usage.mjs';
import { loadBudget, saveBudget } from './lib/budget.mjs';
import { executeDirective } from './lib/directive-exec.mjs';
import { startMdns } from './lib/mdns.mjs';
import { listKeys, addKey, removeKey, pushKey, PROVIDERS, TARGETS } from './lib/keys.mjs';
import { chatTargets, chatOnce } from './lib/chat.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const PORT = +(process.env.PORT || 4177);
const HOSTNAME_ALIAS = process.env.AISPY_HOST || process.env.AGENTOS_HOST || 'ai-spy';

// Discover our own addresses so the Host allowlist can permit intended names while still
// blocking DNS-rebinding (arbitrary Host headers). Allow by hostname, ignoring port.
function selfIdentities() {
  const ips = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
  let magic = null;
  try {
    const r = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 6000, shell: process.platform === 'win32' });
    magic = JSON.parse(r.stdout || '{}').MagicDNSSuffix || null;
  } catch {}
  const names = new Set(['localhost', '127.0.0.1', '::1', '[::1]',
    HOSTNAME_ALIAS, `${HOSTNAME_ALIAS}.local`, hostname().toLowerCase(), `${hostname().toLowerCase()}.local`,
    ...ips]);
  if (magic) names.add(`${HOSTNAME_ALIAS}.${magic}`.toLowerCase());
  return { ips, magic, names };
}
const SELF = selfIdentities();
const START_TIME = Date.now();

// Keep the process alive through stray errors in request handlers, child processes, mDNS,
// or background jobs. The watchdog handles a genuinely wedged process; these handle transients.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

let snapshotCache = null;
let snapshotBuiltAt = 0;
let building = null;
let capsCache = null;
let netCache = null;
let usageCache = null;

function getSnapshot({ maxAgeMs = 5 * 60 * 1000, force = false } = {}) {
  if (!force && snapshotCache && Date.now() - snapshotBuiltAt < maxAgeMs) {
    return Promise.resolve(snapshotCache);
  }
  if (building) return building;
  // async IIFE so `building` is assigned before the .finally microtask can clear it;
  // errors reject and surface as HTTP 500 in the route handler.
  building = (async () => {
    // buildSnapshot is synchronous and can take a few seconds; single-user server, acceptable.
    const snap = buildSnapshot();
    snapshotCache = snap;
    snapshotBuiltAt = Date.now();
    mkdirSync(DATA, { recursive: true });
    writeFileSync(join(DATA, 'snapshot.json'), JSON.stringify(snap, null, 2));
    writeFileSync(join(DATA, `snapshot-${snap.generatedAt.slice(0, 10)}.json`), JSON.stringify(snap));
    return snap;
  })().finally(() => { building = null; });
  return building;
}

// warm the cache from disk so first paint is instant
try {
  snapshotCache = JSON.parse(readFileSync(join(DATA, 'snapshot.json'), 'utf8'));
  snapshotBuiltAt = new Date(snapshotCache.generatedAt).getTime();
} catch {}

// ---- consensus jobs -------------------------------------------------------
const jobs = new Map();
let jobSeq = 0;
const orchJobs = new Map();
let orchSeq = 0;
const chatJobs = new Map();
let chatSeq = 0;
const benchJobs = new Map();
let benchSeq = 0;
let harnessCache = null;

function startConsensusJob(question, engines) {
  const id = String(++jobSeq);
  const job = { id, status: 'running', startedAt: new Date().toISOString(), question, output: '', file: null };
  jobs.set(id, job);
  const args = [join(ROOT, 'agentos.mjs'), 'consensus', question];
  if (engines) args.push(engines);
  const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
  child.stdout.on('data', (d) => { job.output += d; });
  child.stderr.on('data', (d) => { job.output += d; });
  // must exceed the sum of the sequential engine budgets in lib/consensus.mjs (~22 min)
  const timer = setTimeout(() => { try { child.kill(); } catch {} }, 25 * 60 * 1000);
  child.on('close', (code) => {
    clearTimeout(timer);
    job.status = code === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
    const m = job.output.match(/saved: (.*)/);
    if (m) job.file = m[1].trim();
  });
  return job;
}

function listConsensusRuns() {
  const dir = join(DATA, 'consensus');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse().map(f => ({
    id: f.replace('.md', ''),
    content: readFileSync(join(dir, f), 'utf8'),
  }));
}

function listHistory() {
  if (!existsSync(DATA)) return [];
  return readdirSync(DATA)
    .filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map(f => {
      try {
        const s = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
        return {
          date: f.slice(9, 19),
          apiCostUSD: s.claude?.apiEquivalentCostUSD ?? 0,
          sessions: s.claude?.sessions ?? 0,
          userTurns: s.claude?.userTurns ?? 0,
        };
      } catch { return null; }
    }).filter(Boolean);
}

// ---- http -----------------------------------------------------------------
function json(res, code, body) {
  const buf = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(buf);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1e6) throw new Error('body too large'); }
  return body ? JSON.parse(body) : {};
}

// strip port + brackets from a Host/Origin authority -> bare hostname
function hostOf(v) {
  if (!v) return '';
  let h = v.replace(/^https?:\/\//, '');
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']')).toLowerCase();  // [::1]:port
  return h.split(':')[0].toLowerCase();
}
const hostAllowed = (v) => SELF.names.has(hostOf(v));

const requestHandler = async (req, res) => {
  // DNS-rebinding defense: Host must be one of our known names/IPs (any port).
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('forbidden');
  }
  // CSRF defense: a cross-site Origin (a name we don't own) is rejected on mutating requests.
  if (req.method !== 'GET' && req.headers.origin && !hostAllowed(req.headers.origin)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('forbidden');
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    if (path === '/api/health' && req.method === 'GET') {
      const m = process.memoryUsage();
      return json(res, 200, { ok: true, pid: process.pid, uptimeSec: Math.round((Date.now() - START_TIME) / 1000), rssMB: Math.round(m.rss / 1048576), ts: new Date().toISOString() });
    }
    if (path === '/api/snapshot' && req.method === 'GET') {
      return json(res, 200, await getSnapshot({ force: url.searchParams.get('refresh') === '1' }));
    }
    if (path === '/api/refresh' && req.method === 'POST') {
      return json(res, 200, await getSnapshot({ force: true }));
    }
    if (path === '/api/capabilities' && req.method === 'GET') {
      if (!capsCache || url.searchParams.get('refresh') === '1'
          || Date.now() - new Date(capsCache.generatedAt) > 5 * 60 * 1000) {
        capsCache = buildCapabilities();
      }
      return json(res, 200, capsCache);
    }
    if (path === '/api/network' && req.method === 'GET') {
      const lanScan = url.searchParams.get('lan') === '1';
      if (!netCache || lanScan || url.searchParams.get('refresh') === '1'
          || Date.now() - new Date(netCache.generatedAt) > 60 * 1000) {
        netCache = await buildNetwork({ lanScan });
      }
      return json(res, 200, netCache);
    }
    if (path === '/api/usage-live' && req.method === 'GET') {
      if (!usageCache || url.searchParams.get('refresh') === '1'
          || Date.now() - new Date(usageCache.generatedAt) > 60 * 1000) {
        usageCache = await buildSubscriptionUsage();
      }
      return json(res, 200, usageCache);
    }
    // ---- agent fleet control ----
    if (path === '/api/agents' && req.method === 'GET') {
      const reg = await buildAgentState();
      return json(res, 200, { agents: reg.agents, routable: routableModels(reg) });
    }
    if (path === '/api/agents/launch' && req.method === 'POST') {
      const { id } = await readBody(req); return json(res, 200, await launch(id));
    }
    if (path === '/api/agents/restart' && req.method === 'POST') {
      const { id } = await readBody(req); return json(res, 200, await restart(id));
    }
    if (path === '/api/agents/model' && req.method === 'POST') {
      const { id, model } = await readBody(req); return json(res, 200, await setModel(id, model));
    }
    if (path === '/api/agents/rename' && req.method === 'POST') {
      const { id, name } = await readBody(req); return json(res, 200, rename(id, name));
    }
    if (path === '/api/agents/describe' && req.method === 'POST') {
      const { id, description } = await readBody(req); return json(res, 200, describe(id, description));
    }
    // ---- orchestration jobs ----
    if (path === '/api/orchestrate' && req.method === 'POST') {
      const { prompt } = await readBody(req);
      if (!prompt || typeof prompt !== 'string') return json(res, 400, { error: 'prompt required' });
      const id = String(++orchSeq);
      const job = { id, status: 'running', prompt, startedAt: new Date().toISOString(), events: [], result: null };
      orchJobs.set(id, job);
      runOrchestration(prompt, { onEvent: (e) => job.events.push({ t: Date.now(), ...e }) })
        .then(r => { job.result = r; job.status = r.ok ? 'done' : 'failed'; })
        .catch(e => { job.status = 'failed'; job.result = { ok: false, error: String(e).slice(0, 300) }; })
        .finally(() => { job.finishedAt = new Date().toISOString(); });
      return json(res, 202, { jobId: id });
    }
    if (path.startsWith('/api/orchestrate/jobs/') && req.method === 'GET') {
      const job = orchJobs.get(path.split('/').pop());
      if (!job) return json(res, 404, { error: 'no such job' });
      return json(res, 200, job);
    }
    if (path === '/api/orchestrate/plan' && req.method === 'POST') {
      const { prompt } = await readBody(req);
      if (!prompt) return json(res, 400, { error: 'prompt required' });
      return json(res, 200, await planTask(prompt));
    }
    if (path === '/api/orchestrate/execute' && req.method === 'POST') {
      const { prompt, plan } = await readBody(req);
      if (!prompt || !Array.isArray(plan)) return json(res, 400, { error: 'prompt + plan required' });
      const id = String(++orchSeq);
      const job = { id, status: 'running', prompt, startedAt: new Date().toISOString(), events: [], result: null };
      orchJobs.set(id, job);
      executePlan(prompt, plan.slice(0, 5), { onEvent: (e) => job.events.push({ t: Date.now(), ...e }) })
        .then(r => { job.result = r; job.status = r.ok ? 'done' : 'failed'; })
        .catch(e => { job.status = 'failed'; job.result = { ok: false, error: String(e).slice(0, 300) }; })
        .finally(() => { job.finishedAt = new Date().toISOString(); });
      return json(res, 202, { jobId: id });
    }
    if (path === '/api/orchestrate/runs' && req.method === 'GET') {
      return json(res, 200, { runs: listRuns() });
    }
    // ---- local model benchmarks ----
    if (path === '/api/benchmark' && req.method === 'GET') {
      return json(res, 200, { results: listBenchmarks() });
    }
    if (path === '/api/benchmark' && req.method === 'POST') {
      const { agentId, model, all } = await readBody(req);
      if (all) {
        const id = String(++benchSeq);
        const job = { id, status: 'running', startedAt: new Date().toISOString(), events: [], result: null };
        benchJobs.set(id, job);
        benchmarkAll({ onEvent: (e) => job.events.push(e) })
          .then(r => { job.result = r; job.status = 'done'; })
          .catch(e => { job.status = 'failed'; job.result = { ok: false, error: String(e).slice(0, 200) }; });
        return json(res, 202, { jobId: id });
      }
      return json(res, 200, await benchmark(agentId, model));
    }
    if (path.startsWith('/api/benchmark/jobs/') && req.method === 'GET') {
      const job = benchJobs.get(path.split('/').pop());
      if (!job) return json(res, 404, { error: 'no such job' });
      return json(res, 200, job);
    }
    // ---- budget + cross-harness usage ----
    if (path === '/api/budget' && req.method === 'GET') return json(res, 200, loadBudget());
    if (path === '/api/budget' && req.method === 'POST') return json(res, 200, saveBudget(await readBody(req)));
    if (path === '/api/harness-usage' && req.method === 'GET') {
      if (!harnessCache || Date.now() - new Date(harnessCache.generatedAt) > 5 * 60 * 1000) harnessCache = buildHarnessUsage();
      return json(res, 200, harnessCache);
    }
    if (path === '/api/history' && req.method === 'GET') {
      return json(res, 200, listHistory());
    }
    if (path === '/api/recommendations' && req.method === 'GET') {
      let md = '';
      try { md = readFileSync(join(DATA, 'recommendations.md'), 'utf8'); } catch {}
      return json(res, 200, { markdown: md });
    }
    if (path === '/api/consensus' && req.method === 'GET') {
      return json(res, 200, { runs: listConsensusRuns(), jobs: [...jobs.values()].map(j => ({ ...j, output: undefined })) });
    }
    if (path === '/api/consensus' && req.method === 'POST') {
      const { question, engines } = await readBody(req);
      if (!question || typeof question !== 'string') return json(res, 400, { error: 'question required' });
      const job = startConsensusJob(question, engines);
      return json(res, 202, { jobId: job.id });
    }
    if (path.startsWith('/api/consensus/jobs/') && req.method === 'GET') {
      const job = jobs.get(path.split('/').pop());
      if (!job) return json(res, 404, { error: 'no such job' });
      return json(res, 200, job);
    }
    // ---- direct 1:1 chat with a single agent ----
    if (path === '/api/chat/targets' && req.method === 'GET') {
      return json(res, 200, { targets: await chatTargets() });
    }
    if (path === '/api/chat' && req.method === 'POST') {
      const { agentId, model, messages } = await readBody(req);
      const id = String(++chatSeq);
      const job = { id, status: 'running', startedAt: new Date().toISOString(), result: null };
      chatJobs.set(id, job);
      chatOnce({ agentId, model, messages })
        .then(r => { job.result = r; job.status = r.ok ? 'done' : 'failed'; })
        .catch(e => { job.status = 'failed'; job.result = { ok: false, error: String(e).slice(0, 300) }; });
      return json(res, 202, { jobId: id });
    }
    if (path.startsWith('/api/chat/jobs/') && req.method === 'GET') {
      const job = chatJobs.get(path.split('/').pop());
      if (!job) return json(res, 404, { error: 'no such job' });
      return json(res, 200, job);
    }
    // ---- API key vault (secrets stay server-side; list is masked) ----
    if (path === '/api/keys' && req.method === 'GET') {
      return json(res, 200, { keys: listKeys(), providers: PROVIDERS, targets: TARGETS });
    }
    if (path === '/api/keys' && req.method === 'POST') {
      return json(res, 200, addKey(await readBody(req)));
    }
    if (path === '/api/keys/remove' && req.method === 'POST') {
      const { id } = await readBody(req); return json(res, 200, removeKey(id));
    }
    if (path === '/api/keys/push' && req.method === 'POST') {
      const { id, targets } = await readBody(req);
      const r = pushKey(id, targets);
      usageCache = null; // re-read live usage now that a key may be present
      return json(res, 200, r);
    }
    if (path === '/api/directive/execute' && req.method === 'POST') {
      const { verb, target } = await readBody(req);
      const r = executeDirective({ verb, target });
      capsCache = null; // invalidate so the Perks page reflects the change on next load
      return json(res, 200, r);
    }
    // static
    let file = path === '/' ? '/index.html' : path;
    file = normalize(file).replace(/^([/\\])+/, '');
    const full = join(PUBLIC, file);
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    if (existsSync(full)) {
      res.writeHead(200, { 'content-type': MIME[extname(full)] || 'application/octet-stream' });
      return res.end(readFileSync(full));
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
};

// Bind to all interfaces so the LAN + Tailscale can reach it; the Host allowlist above
// preserves DNS-rebinding protection. Main port always; port 80 best-effort so the bare
// hostname (http://agentos.local / http://agentos) works with no port.
function listen(port, label) {
  const s = createServer(requestHandler);
  s.on('error', (e) => console.log(`port ${port} (${label}) unavailable: ${e.code || e.message}`));
  s.listen(port, '0.0.0.0', () => console.log(`Agent OS listening on 0.0.0.0:${port} (${label})`));
  return s;
}
listen(PORT, 'app');
if (PORT !== 80) listen(80, 'hostname');

// Advertise agentos.local on the LAN via mDNS.
startMdns({
  names: [`${HOSTNAME_ALIAS}.local`],
  ipv4: SELF.ips.find(ip => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(ip)) || SELF.ips[0],
  onLog: (m) => console.log(m),
});

console.log('Reach it at:');
console.log(`  LAN:       http://${HOSTNAME_ALIAS}.local  (or :${PORT})`);
if (SELF.magic) console.log(`  Tailscale: http://${HOSTNAME_ALIAS}  (MagicDNS; run: tailscale set --hostname ${HOSTNAME_ALIAS})`);
