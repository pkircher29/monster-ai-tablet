#!/usr/bin/env node
// AI-Spy watchdog — supervises server.mjs. Restarts it if it crashes (exponential backoff)
// or hangs (repeated health-check failures). Zero dependencies. Run this instead of server.mjs
// for an always-on box:  node watchdog.mjs
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOG = join(ROOT, 'data', 'watchdog.log');
const PORT = +(process.env.PORT || 4177);
const HEALTH = `http://127.0.0.1:${PORT}/api/health`;

const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 30000;
const HEALTH_INTERVAL = 15000;      // poll every 15s
const HEALTH_FAILS_BEFORE_KILL = 3; // ~45s unresponsive -> force restart
const HEALTHY_RESET_MS = 60000;     // running this long clean -> reset backoff

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, line + '\n'); } catch {}
}

let child = null;
let backoff = MIN_BACKOFF;
let restarts = 0;
let healthFails = 0;
let stopping = false;
let startedAt = 0;
let healthyTimer = null;

function start() {
  startedAt = Date.now();
  child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    stdio: ['ignore', 'inherit', 'inherit'],   // server logs flow through to the watchdog console
    env: process.env,
    windowsHide: true,
  });
  log(`server started (pid ${child.pid})`);

  // if it stays up cleanly for a while, reset the backoff so a later crash retries fast
  clearTimeout(healthyTimer);
  healthyTimer = setTimeout(() => { backoff = MIN_BACKOFF; }, HEALTHY_RESET_MS);

  child.on('exit', (code, signal) => {
    clearTimeout(healthyTimer);
    if (stopping) return;
    const alive = Date.now() - startedAt;
    restarts++;
    log(`server exited (code=${code} signal=${signal}) after ${Math.round(alive / 1000)}s — restart #${restarts} in ${backoff}ms`);
    setTimeout(start, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  });
  child.on('error', (e) => log(`spawn error: ${e.message}`));
}

async function pollHealth() {
  if (!child || stopping) return;
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('status ' + r.status);
    if (healthFails) log('health recovered');
    healthFails = 0;
  } catch (e) {
    healthFails++;
    log(`health check failed (${healthFails}/${HEALTH_FAILS_BEFORE_KILL}): ${e.message}`);
    if (healthFails >= HEALTH_FAILS_BEFORE_KILL) {
      log('server unresponsive — killing to force a restart');
      healthFails = 0;
      try { child.kill(); } catch {}   // exit handler respawns it
    }
  }
}

function shutdown() {
  stopping = true;
  log('watchdog stopping');
  try { child?.kill(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log(`watchdog starting — supervising server on port ${PORT}`);
start();
setInterval(pollHealth, HEALTH_INTERVAL);
