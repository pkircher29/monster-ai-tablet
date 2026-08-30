#!/usr/bin/env node
// AI-Spy web server — live dashboard, universal cross-agent skill hub, and agent agora.
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
import { scanAllSkills, saveSkill, deploySkillToHarness, scanAllMcpServers, transmuteSkill } from './lib/skill-hub.mjs';
import { loadRooms, saveRooms, getRoom, createRoom, postMessage, stepNextAgent } from './lib/agent-agora.mjs';
import { hermesInventory, hermesUsage, getHermesGatewayState } from './lib/hermes.mjs';
import { runConsensus, generateSuggestedFollowups } from './lib/consensus.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const PORT = +(process.env.PORT || 4177);
const HOSTNAME_ALIAS = process.env.AISPY_HOST || process.env.AGENTOS_HOST || 'ai-spy';

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

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
  });
}

let snapshotCache = null;
function getSnapshot({ force = false } = {}) {
  if (!force && snapshotCache && Date.now() - snapshotCache.time < 30000) return snapshotCache.data;
  try {
    const d = buildSnapshot();
    snapshotCache = { time: Date.now(), data: d };
    return d;
  } catch (e) {
    if (snapshotCache) return snapshotCache.data;
    throw e;
  }
}

let capsCache = null;
let netCache = null;
let usageCache = null;
let harnessCache = null;
let orchJobs = new Map();
let orchSeq = 0;
let benchJobs = new Map();
let benchSeq = 0;
let chatJobs = new Map();
let chatSeq = 0;
const consensusJobs = new Map();
let consensusSeq = 0;

function startConsensusJob(question, engines, parentRunId = null) {
  const id = String(++consensusSeq);
  const job = { id, status: 'running', startedAt: new Date().toISOString(), question, parentRunId, output: '', file: null };
  consensusJobs.set(id, job);

  runConsensus(question, { engines, parentRunId })
    .then(r => {
      job.status = 'done';
      job.result = r;
      job.file = r.file;
      job.finishedAt = new Date().toISOString();
    })
    .catch(e => {
      job.status = 'failed';
      job.error = String(e.message || e);
      job.finishedAt = new Date().toISOString();
    });

  return job;
}

function listConsensusRuns() {
  const dir = join(DATA, 'consensus');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).sort().reverse();
  const runs = [];
  const seenIds = new Set();

  for (const f of files) {
    const id = f.replace(/\.(json|md)$/, '');
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const jsonPath = join(dir, `${id}.json`);
    const mdPath = join(dir, `${id}.md`);

    if (existsSync(jsonPath)) {
      try {
        const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
        runs.push(data);
        continue;
      } catch {}
    }

    if (existsSync(mdPath)) {
      try {
        const content = readFileSync(mdPath, 'utf8');
        runs.push({
          id,
          createdAt: id,
          originalQuestion: id,
          turns: [
            {
              turnIndex: 1,
              question: id,
              answers: [],
              rawMarkdown: content,
              suggestedFollowups: [
                'What are the performance trade-offs?',
                'Can you provide a concrete code example?',
                'How should we structure unit tests for this?'
              ]
            }
          ]
        });
      } catch {}
    }
  }

  return runs;
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

const requestHandler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }

  const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
  if (hostHeader && !SELF.names.has(hostHeader)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end(`Host header "${hostHeader}" not recognized. Access via localhost or ${HOSTNAME_ALIAS}.local`);
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  try {
    if (path === '/api/health') {
      return json(res, 200, { ok: true, pid: process.pid, uptimeSec: Math.floor((Date.now() - START_TIME) / 1000), rssMB: Math.round(process.memoryUsage().rss / 1048576), ts: new Date().toISOString() });
    }
    if (path === '/api/snapshot' && req.method === 'GET') {
      return json(res, 200, getSnapshot());
    }
    if (path === '/api/snapshot/refresh' && req.method === 'POST') {
      return json(res, 200, getSnapshot({ force: true }));
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
      return json(res, 200, { runs: listConsensusRuns(), jobs: [...consensusJobs.values()].map(j => ({ ...j, output: undefined })) });
    }
    if (path === '/api/consensus' && req.method === 'POST') {
      const { question, engines } = await readBody(req);
      if (!question || typeof question !== 'string') return json(res, 400, { error: 'question required' });
      const job = startConsensusJob(question, engines);
      return json(res, 202, { jobId: job.id });
    }
    if (path === '/api/consensus/followup' && req.method === 'POST') {
      const { parentRunId, question, engines } = await readBody(req);
      if (!parentRunId || !question) return json(res, 400, { error: 'parentRunId and question required' });
      const job = startConsensusJob(question, engines, parentRunId);
      return json(res, 202, { jobId: job.id, parentRunId });
    }
    if (path.startsWith('/api/consensus/jobs/') && req.method === 'GET') {
      const job = consensusJobs.get(path.split('/').pop());
      if (!job) return json(res, 404, { error: 'no such job' });
      return json(res, 200, job);
    }
    if (path === '/api/capabilities' && req.method === 'GET') {
      if (!capsCache || url.searchParams.get('refresh') === '1' || Date.now() - new Date(capsCache.generatedAt) > 5 * 60 * 1000) {
        capsCache = buildCapabilities();
      }
      return json(res, 200, capsCache);
    }
    if (path === '/api/network' && req.method === 'GET') {
      const lanScan = url.searchParams.get('lan') === '1';
      if (!netCache || lanScan || url.searchParams.get('refresh') === '1' || Date.now() - new Date(netCache.generatedAt) > 60 * 1000) {
        netCache = await buildNetwork({ lanScan });
      }
      return json(res, 200, netCache);
    }
    if (path === '/api/usage-live' && req.method === 'GET') {
      if (!usageCache || url.searchParams.get('refresh') === '1' || Date.now() - new Date(usageCache.generatedAt) > 60 * 1000) {
        usageCache = await buildSubscriptionUsage();
      }
      return json(res, 200, usageCache);
    }
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

    // ---- Universal Skill Hub APIs ----
    if (path === '/api/skills/library' && req.method === 'GET') {
      const skills = scanAllSkills();
      return json(res, 200, { skills, count: skills.length });
    }
    if (path === '/api/skills/save' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, saveSkill(body));
    }
    if (path === '/api/skills/deploy' && req.method === 'POST') {
      const body = await readBody(req);
      const resDeploy = deploySkillToHarness(body);
      capsCache = null;
      return json(res, 200, resDeploy);
    }
    if (path === '/api/skills/mcp' && req.method === 'GET') {
      return json(res, 200, { servers: scanAllMcpServers() });
    }
    if (path === '/api/skills/transmute' && req.method === 'POST') {
      const { content, targetHarness, overrides } = await readBody(req);
      const transmuted = transmuteSkill(content, targetHarness, overrides);
      return json(res, 200, { ok: true, transmuted });
    }

    // ---- Agent Agora / Round Table APIs ----
    if (path === '/api/agora/rooms' && req.method === 'GET') {
      return json(res, 200, { rooms: loadRooms() });
    }
    if (path === '/api/agora/rooms' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, createRoom(body));
    }
    if (path === '/api/agora/room' && req.method === 'GET') {
      const roomId = url.searchParams.get('id') || 'general-agora';
      const room = getRoom(roomId);
      if (!room) return json(res, 404, { error: 'Room not found' });
      return json(res, 200, { room });
    }
    if (path === '/api/agora/message' && req.method === 'POST') {
      const { roomId, sender, text, role } = await readBody(req);
      return json(res, 200, postMessage(roomId, { sender: sender || 'User', text, role: role || 'human' }));
    }
    if (path === '/api/agora/step' && req.method === 'POST') {
      const { roomId, requestedAgent } = await readBody(req);
      const result = await stepNextAgent(roomId, requestedAgent);
      return json(res, 200, result);
    }

    // ---- Hermes Status API ----
    if (path === '/api/hermes/status' && req.method === 'GET') {
      return json(res, 200, {
        inventory: hermesInventory(),
        usage: hermesUsage(),
        gateway: getHermesGatewayState()
      });
    }

    // ---- Orchestration, Benchmarks, Budget, Keys ----
    if (path === '/api/orchestrate' && req.method === 'POST') {
      const { prompt } = await readBody(req);
      if (!prompt) return json(res, 400, { error: 'prompt required' });
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
    if (path === '/api/benchmark' && req.method === 'GET') return json(res, 200, { results: listBenchmarks() });
    if (path === '/api/benchmark' && req.method === 'POST') {
      const { agentId, model } = await readBody(req);
      return json(res, 200, await benchmark(agentId, model));
    }
    if (path === '/api/budget' && req.method === 'GET') return json(res, 200, loadBudget());
    if (path === '/api/budget' && req.method === 'POST') return json(res, 200, saveBudget(await readBody(req)));
    if (path === '/api/harness-usage' && req.method === 'GET') {
      harnessCache = buildHarnessUsage();
      return json(res, 200, harnessCache);
    }
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
    if (path === '/api/keys' && req.method === 'GET') return json(res, 200, { keys: listKeys(), providers: PROVIDERS, targets: TARGETS });
    if (path === '/api/keys' && req.method === 'POST') return json(res, 200, addKey(await readBody(req)));
    if (path === '/api/keys/remove' && req.method === 'POST') {
      const { id } = await readBody(req); return json(res, 200, removeKey(id));
    }
    if (path === '/api/keys/push' && req.method === 'POST') {
      const { id, targets } = await readBody(req);
      return json(res, 200, pushKey(id, targets));
    }
    if (path === '/api/directive/execute' && req.method === 'POST') {
      const { verb, target } = await readBody(req);
      const r = executeDirective({ verb, target });
      capsCache = null;
      return json(res, 200, r);
    }

    // Static assets
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

function listen(port, label) {
  const s = createServer(requestHandler);
  s.on('error', (e) => console.log(`port ${port} (${label}) unavailable: ${e.code || e.message}`));
  s.listen(port, '0.0.0.0', () => console.log(`AI-Spy listening on 0.0.0.0:${port} (${label})`));
  return s;
}
listen(PORT, 'app');
if (PORT !== 80) listen(80, 'hostname');

startMdns({
  names: [`${HOSTNAME_ALIAS}.local`],
  ipv4: SELF.ips.find(ip => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(ip)) || SELF.ips[0],
  onLog: (m) => console.log(m),
});

console.log('Reach it at:');
console.log(`  LAN:       http://${HOSTNAME_ALIAS}.local  (or :${PORT})`);
if (SELF.magic) console.log(`  Tailscale: http://${HOSTNAME_ALIAS}  (MagicDNS; run: tailscale set --hostname ${HOSTNAME_ALIAS})`);
