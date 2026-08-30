import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Socket } from 'node:net';

// Known agent/runtime services keyed by listening port. identify = HTTP path that returns a model list.
const AGENT_PORTS = {
  11434: { tool: 'Ollama',              kind: 'local-llm', identify: '/api/tags',   parse: (j) => (j.models || []).map(m => m.name) },
  1234:  { tool: 'LM Studio',           kind: 'local-llm', identify: '/v1/models',  parse: (j) => (j.data || []).map(m => m.id) },
  8080:  { tool: 'Open WebUI',          kind: 'ui',        identify: '/api/models', parse: (j) => (j.data || []).map(m => m.id) },
  5000:  { tool: 'text-generation-webui', kind: 'local-llm', identify: '/v1/models', parse: (j) => (j.data || []).map(m => m.id) },
  1337:  { tool: 'Jan',                 kind: 'local-llm', identify: '/v1/models',  parse: (j) => (j.data || []).map(m => m.id) },
  5001:  { tool: 'KoboldCpp',           kind: 'local-llm', identify: '/v1/models',  parse: (j) => (j.data || []).map(m => m.id) },
  8000:  { tool: 'vLLM / LocalAI',      kind: 'local-llm', identify: '/v1/models',  parse: (j) => (j.data || []).map(m => m.id) },
};

export function localIPs() {
  const out = { lan: null, tailscale: null, all: [] };
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.all.push(a.address);
      if (a.address.startsWith('100.')) out.tailscale = a.address;
      else if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(a.address)) out.lan = a.address;
    }
  }
  return out;
}

export function tailscalePeers() {
  try {
    const r = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32' });
    if (r.status !== 0) return [];
    const j = JSON.parse(r.stdout);
    const peers = [];
    const add = (p, self) => peers.push({
      ip: (p.TailscaleIPs || [])[0] || null,
      host: p.HostName || p.DNSName?.split('.')[0] || '?',
      os: p.OS, online: self ? true : !!p.Online, self,
      lastSeen: p.LastSeen || null,
    });
    if (j.Self) add(j.Self, true);
    for (const p of Object.values(j.Peer || {})) add(p, false);
    return peers;
  } catch { return []; }
}

export function localListeners() {
  if (process.platform === 'win32') {
    const ps = `Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -lt 49500 } | ForEach-Object { $p = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName; "$($_.LocalPort)|$($_.LocalAddress)|$p" } | Sort-Object -Unique`;
    try {
      const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 12000 });
      return (r.stdout || '').split(/\r?\n/).filter(Boolean).map(l => {
        const [port, addr, proc] = l.split('|');
        return { port: +port, addr, proc };
      });
    } catch { return []; }
  } else {
    // Linux / POSIX: parse ss -tlpn
    try {
      const r = spawnSync('ss', ['-tlpn'], { encoding: 'utf8', timeout: 6000 });
      const listeners = [];
      const lines = (r.stdout || '').split('\n');
      for (const line of lines) {
        if (!line.startsWith('LISTEN')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const localAddr = parts[3];
          const lastColon = localAddr.lastIndexOf(':');
          if (lastColon !== -1) {
            const addr = localAddr.slice(0, lastColon);
            const port = parseInt(localAddr.slice(lastColon + 1), 10);
            let proc = 'unknown';
            const matchProc = line.match(/users:\(\("([^"]+)"/);
            if (matchProc) proc = matchProc[1];
            if (port > 0 && port < 49500) {
              listeners.push({ port, addr, proc });
            }
          }
        }
      }
      return listeners;
    } catch { return []; }
  }
}

export function tcpOpen(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = new Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { s.destroy(); } catch {} resolve(v); } };
    s.setTimeout(timeout);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, host);
  });
}

export async function identify(host, port) {
  const spec = AGENT_PORTS[port];
  if (!spec) return { models: [], ok: false };
  try {
    const ctrl = AbortSignal.timeout(3000);
    const r = await fetch(`http://${host}:${port}${spec.identify}`, { signal: ctrl });
    if (!r.ok) return { models: [], ok: false, status: r.status };
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) { const j = await r.json(); return { models: spec.parse(j), ok: true }; }
    return { models: [], ok: true };
  } catch { return { models: [], ok: false }; }
}

export async function scanHost(ip, label) {
  const services = [];
  await Promise.all(Object.keys(AGENT_PORTS).map(async (portStr) => {
    const port = +portStr;
    if (!(await tcpOpen(ip, port))) return;
    const spec = AGENT_PORTS[port];
    const info = await identify(ip, port);
    services.push({ host: label, ip, port, tool: spec.tool, kind: spec.kind, reachable: info.ok, models: info.models });
  }));
  return services;
}

export async function buildNetwork({ lanScan = false } = {}) {
  const ips = localIPs();
  const peers = tailscalePeers();
  const listeners = localListeners();

  const agents = [];

  const self = await scanHost('127.0.0.1', 'this-machine');
  for (const s of self) {
    agents.push({ ...s, node: 'this-machine', lanIP: ips.lan, tailscaleIP: ips.tailscale, self: true });
  }

  const onlinePeers = peers.filter(p => !p.self && p.online && p.ip);
  const peerResults = await Promise.all(onlinePeers.map(p => scanHost(p.ip, p.host)));
  peerResults.forEach((svcs, i) => {
    for (const s of svcs) agents.push({ ...s, node: onlinePeers[i].host, lanIP: null, tailscaleIP: onlinePeers[i].ip, self: false });
  });

  if (lanScan && ips.lan) {
    const base = ips.lan.split('.').slice(0, 3).join('.');
    const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`).filter(h => h !== ips.lan);
    const ports = [11434, 1234, 3030];
    const hits = [];
    const queue = [...hosts];
    async function worker() {
      while (queue.length) {
        const h = queue.shift();
        for (const port of ports) {
          if (await tcpOpen(h, port, 700)) { hits.push({ ip: h, port }); break; }
        }
      }
    }
    await Promise.all(Array.from({ length: 48 }, worker));
    for (const hit of hits) {
      const info = await identify(hit.ip, hit.port);
      const spec = AGENT_PORTS[hit.port];
      agents.push({ node: hit.ip, ip: hit.ip, port: hit.port, tool: spec.tool, kind: spec.kind, reachable: info.ok, models: info.models, lanIP: hit.ip, tailscaleIP: null, self: false });
    }
  }

  const knownPorts = new Set(Object.keys(AGENT_PORTS).map(Number));
  const otherExposed = listeners.filter(l => !knownPorts.has(l.port) && l.proc && !['System', 'svchost', 'Idle'].includes(l.proc));

  return {
    generatedAt: new Date().toISOString(),
    localIPs: ips,
    tailscale: { peers, online: peers.filter(p => p.online).length, total: peers.length },
    agents,
    otherExposed,
    lanScanned: lanScan,
  };
}
