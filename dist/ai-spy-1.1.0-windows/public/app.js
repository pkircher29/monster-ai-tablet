/* AGENT OS console — SPA over /api/*. No frameworks. */
const $ = (sel, el = document) => el.querySelector(sel);
const main = $('#main');

const state = { snap: null, history: [], recs: '', consensus: { runs: [], jobs: [] }, caps: null, net: null, usageLive: null, agents: null, orch: null, keys: null,
  term: { targets: null, agentId: null, model: null, threads: {}, pending: false },
  budget: null, benchmarks: null, orchRuns: null, harness: null,
  vats: { plan: null, catalog: null, editing: false } };

/* ---------- utils ---------- */
const usd = (n, d = 0) => '$' + (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: d });
const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n ?? 0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const days = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null;

function setLive(ok) {
  const dot = $('#live-dot'), label = $('#live-label');
  dot.className = 'dot ' + (ok === true ? 'on' : ok === false ? 'err' : '');
  label.textContent = ok === true ? 'LIVE' : ok === false ? 'OFFLINE' : 'SYNCING';
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok && r.status !== 202) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

/* ---------- derived numbers ---------- */
// Dir mtimes lie for tools whose config gets touched by background token refreshes.
// Prefer real session-history timestamps where we parse them.
function trueLastUse(snap, t) {
  if (t.id === 'gemini-cli' && snap.gemini?.lastActivity) return snap.gemini.lastActivity;
  if (t.id === 'codex' && snap.codex?.lastActivity) return snap.codex.lastActivity;
  return t.lastActivity;
}
function correctedTools(snap) {
  return (snap.scan?.tools || []).map(t => {
    const last = trueLastUse(snap, t);
    return { ...t, lastActivity: last, daysSinceUse: last ? days(last) : t.daysSinceUse };
  });
}
function derive(snap) {
  const cc = snap.claude || {};
  const subs = snap.subscriptions?.subscriptions || [];
  const monthlySubs = subs.reduce((a, s) => a + (s.monthlyUSD || 0), 0);
  const claudeSub = subs.find(s => s.tool === 'claude-code')?.monthlyUSD || 0;
  // all byMonth/byDay buckets are UTC-keyed; stay in UTC throughout
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const monthEquiv = cc.byMonth?.[thisMonth]?.apiCostUSD ?? 0;
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const monthPace = dayOfMonth ? (monthEquiv / dayOfMonth) * daysInMonth : 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayBurn = cc.byDay?.[today]?.apiCostUSD ?? 0;
  const tools = correctedTools(snap);
  const active = tools.filter(t => t.daysSinceUse !== null && t.daysSinceUse <= 14).length;
  const idleGB = (snap.lmstudio?.totalGB ?? 0) + (snap.ollamaGB ?? 0);
  const roi = claudeSub ? monthPace / claudeSub : null;
  // paying-for-idle alerts: map sub tool ids to scan entries
  const idBy = { antigravity: 'antigravity', 'gemini-cli': 'gemini-cli', codex: 'codex', 'claude-code': 'claude-code', copilot: 'copilot', opencode: 'opencode', ollama: 'ollama', lmstudio: 'lmstudio' };
  const alerts = [];
  for (const s of subs) {
    if (!s.monthlyUSD) continue;
    const t = tools.find(x => x.id === idBy[s.tool]);
    if (!t) { if (s.tool !== 'openrouter') continue; alerts.push({ level: 'warn', text: `<b>${esc(s.plan)}</b> ${usd(s.monthlyUSD)}/mo — no local usage traces. Check provider dashboard.` }); continue; }
    const d = t.daysSinceUse;
    if (d === null || d > 30) alerts.push({ level: 'bad', text: `<b>${esc(s.plan)}</b> ${usd(s.monthlyUSD)}/mo — ${esc(t.name)} ${d === null ? 'never used' : 'idle ' + d + ' days'}. Cancel candidate.` });
  }
  return { cc, subs, monthlySubs, claudeSub, monthEquiv, monthPace, todayBurn, tools, active, idleGB, roi, alerts };
}

/* ---------- components ---------- */
function ledMeter({ label, value, note, frac, invert = false }) {
  const SEG = 24;
  const lit = Math.max(0, Math.min(SEG, Math.round((frac ?? 0) * SEG)));
  let leds = '';
  for (let i = 0; i < SEG; i++) {
    // normal: high = hot (spend meters). invert: high = good (value/ROI meters).
    const zone = invert
      ? (i < SEG * 0.15 ? 'r' : i < SEG * 0.4 ? 'a' : 'g')
      : (i < SEG * 0.6 ? 'g' : i < SEG * 0.85 ? 'a' : 'r');
    const on = i < lit;
    leds += `<span class="led ${on ? zone + ' lit' : ''}" style="animation-delay:${i * 18}ms"></span>`;
  }
  return `<div class="meter-card">
    <div class="meter-label">${esc(label)}</div>
    <div class="meter-value">${value}</div>
    <div class="led-row">${leds}</div>
    ${note ? `<div class="meter-note">${note}</div>` : ''}
  </div>`;
}

function barChart(entries, { width = 900, height = 160, color = () => '' } = {}) {
  if (!entries.length) return '<div class="chart">no data yet</div>';
  const max = Math.max(...entries.map(e => e.v), 0.001);
  const bw = Math.min(40, (width - 20) / entries.length - 4);
  const bars = entries.map((e, i) => {
    const h = Math.max(2, (e.v / max) * (height - 38));
    const x = 10 + i * ((width - 20) / entries.length);
    return `<rect class="bar-rect ${color(e)}" x="${x}" y="${height - 22 - h}" width="${bw}" height="${h}" rx="2"><title>${esc(e.k)}: ${e.title ?? e.v}</title></rect>
      ${entries.length <= 16 || i % Math.ceil(entries.length / 16) === 0 ? `<text class="axis-t" x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(e.k)}</text>` : ''}`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">${bars}</svg></div>`;
}

function harnessUsageBlock() {
  const h = state.harness;
  if (!h) return '';
  const c = h.codex, a = h.antigravity;
  let out = '<h2>Other harness activity (from session logs)</h2>';
  if (c) {
    const months = Object.entries(c.byMonth || {}).sort().map(([k, v]) => `${k}: ${v}`).join(' · ');
    out += `<div class="panel" style="padding:14px"><b>Codex</b> — ${c.sessions} sessions, ${c.turns} tasks, last ${esc((c.lastActivity || '').slice(0, 10) || 'never')}.
      ${c.tokens ? c.tokens.toLocaleString() + ' tokens.' : `<span style="color:var(--dim)">${esc(c.tokenNote || '')}</span>`}
      <div class="strip-meta" style="margin-top:6px">by month: ${esc(months)}</div>
      <div class="strip-meta">top projects: ${esc(Object.keys(c.byProject || {}).slice(0, 5).join(', '))}</div></div>`;
  }
  if (a) {
    out += `<div class="panel" style="padding:14px;margin-top:8px"><b>Antigravity (Gemini)</b> — ${a.sessions} agent sessions, ${a.turns} user turns, last ${esc((a.lastActivity || '').slice(0, 10) || 'never')}.
      <span style="color:var(--dim)">${esc(a.tokenNote || '')}</span></div>`;
  }
  return out;
}

function liveUsageBlock() {
  const u = state.usageLive;
  if (!u) return '<div class="alert warn">Live usage not loaded.</div>';
  const rows = [];
  for (const p of u.live) {
    if (p.provider === 'openrouter') {
      if (!p.available) { rows.push(['OpenRouter', '—', '—', p.note || 'unavailable', 'warn']); continue; }
      const used = p.usedUSD != null ? usd(p.usedUSD, 2) : '—';
      const rem = p.limitUSD === null ? 'pay-as-you-go' : (p.remainingUSD != null ? usd(p.remainingUSD, 2) : '—');
      rows.push(['OpenRouter', used + ' spent', rem, p.note || '', 'ok']);
    } else if (p.provider === 'anthropic-api') {
      if (!p.available) { rows.push(['Anthropic API', '—', '—', p.note || 'unavailable', 'warn']); continue; }
      const l = p.limits;
      rows.push(['Anthropic API', `${l.inputTokensRemaining ?? '?'} / ${l.inputTokensLimit ?? '?'} in-tok`, `${l.requestsRemaining ?? '?'} / ${l.requestsLimit ?? '?'} req`, 'per-minute rate limits (not subscription quota)', 'ok']);
    } else if (p.provider === 'ollama') {
      if (!p.available) { rows.push(['Ollama', '—', '—', 'not running', 'warn']); continue; }
      rows.push(['Ollama', `${p.modelsInstalled} models installed`, p.loadedNow?.length ? p.loadedNow.join(', ') + ' loaded' : 'idle', 'local — no quota', 'ok']);
    } else if (p.provider === 'lmstudio') {
      if (!p.available) { rows.push(['LM Studio', '—', '—', 'not running', 'warn']); continue; }
      rows.push(['LM Studio', `${p.modelsLoaded?.length ?? 0} models loaded`, '∞', 'local — no quota', 'ok']);
    }
  }
  const liveRows = rows.map(([prov, used, rem, note, cls]) =>
    `<tr><td>${esc(prov)}</td><td>${esc(used)}</td><td>${esc(rem)}</td><td style="color:var(--dim)">${esc(note)}</td></tr>`).join('');
  const dash = (u.dashboardOnly || []).map(d =>
    `<tr><td>${esc(d.label)}</td><td colspan="2" style="color:var(--dim)">${esc(d.note)}</td><td><a href="${esc(d.where)}" target="_blank" rel="noopener" style="color:var(--phos)">${esc(d.where.startsWith('http') ? 'open dashboard' : d.where)}</a></td></tr>`).join('');
  return `<div class="panel"><table><tr><th>Provider</th><th>Used</th><th>Remaining</th><th>Scope</th></tr>${liveRows}</table></div>
    <div class="alert info" style="margin-top:8px">Programmatic quota only exists for OpenRouter (credit balance) and the Anthropic API (per-minute rate limits). Subscription plans below expose usage only through their web dashboards:</div>
    <div class="panel"><table><tr><th>Subscription</th><th colspan="2">Why no live number</th><th>Where it lives</th></tr>${dash}</table></div>`;
}

// area/line chart for a time series [{k,v}]
function lineChart(entries, { width = 900, height = 180, color = 'var(--phos)' } = {}) {
  if (!entries.length) return '<div class="chart">no data</div>';
  const max = Math.max(...entries.map(e => e.v), 0.001);
  const pad = 26, w = width - pad * 2, h = height - 34;
  const x = (i) => pad + (entries.length === 1 ? w / 2 : (i / (entries.length - 1)) * w);
  const y = (v) => pad / 2 + h - (v / max) * h;
  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e.v).toFixed(1)}`).join(' ');
  const area = `${pad},${(pad / 2 + h).toFixed(1)} ${pts} ${(pad + w).toFixed(1)},${(pad / 2 + h).toFixed(1)}`;
  const ticks = entries.filter((_, i) => i % Math.ceil(entries.length / 8) === 0 || i === entries.length - 1)
    .map((e, i, arr) => { const gi = entries.indexOf(e); return `<text class="axis-t" x="${x(gi).toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(e.k)}</text>`; }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">
    <polygon points="${area}" fill="${color}" opacity="0.14"></polygon>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"></polyline>
    <text class="axis-t" x="${pad}" y="${pad / 2 + 4}">${usd(max, 0)}</text>
    ${ticks}</svg></div>`;
}

function mdRender(md) {
  const lines = (md || '').split('\n');
  let html = '', inTable = false, inList = false;
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\|/.test(l)) {
      if (/^\|[\s:-]+\|/.test(l.replace(/-/g, '-'))) continue; // separator row
      const cells = l.split('|').slice(1, -1).map(c => inline(c.trim()));
      if (!inTable) { html += '<table>'; inTable = true; html += '<tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>'; continue; }
      html += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>'; continue;
    } else if (inTable) { html += '</table>'; inTable = false; }
    if (/^[-*] /.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(l.slice(2))}</li>`; continue; }
    else if (inList) { html += '</ul>'; inList = false; } // any non-list line ends the list
    if (/^### /.test(l)) html += `<h3>${inline(l.slice(4))}</h3>`;
    else if (/^## /.test(l)) html += `<h2>${inline(l.slice(3))}</h2>`;
    else if (/^# /.test(l)) html += `<h1>${inline(l.slice(2))}</h1>`;
    else if (l) html += `<p>${inline(l)}</p>`;
  }
  if (inTable) html += '</table>';
  if (inList) html += '</ul>';
  return html;
}

/* ---------- pages ---------- */
const pages = {
  overview(snap) {
    const d = derive(snap);
    const maxMonth = Math.max(...Object.values(d.cc.byMonth || {}).map(v => v.apiCostUSD || 0), 1);
    const meters = [
      ledMeter({ label: 'Value vs plan · this month pace', value: d.roi === null ? '—' : `${d.roi.toFixed(1)}<small>×</small>`, frac: d.roi === null ? 0 : d.roi / 8, invert: true, note: `API-equivalent pace ${usd(d.monthPace)}/mo against ${usd(d.claudeSub)}/mo Claude Max — green = earning its cost` }),
      ledMeter({ label: 'This month · API-equivalent', value: `${usd(d.monthEquiv)}`, frac: d.monthEquiv / (maxMonth * 1.2), note: 'value of tokens burned, priced at API rates' }),
      ledMeter({ label: "Today's burn", value: `${usd(d.todayBurn)}`, frac: d.todayBurn / Math.max(60, d.todayBurn), note: 'API-equivalent today' }),
      ledMeter({ label: 'Declared subscriptions', value: `${usd(d.monthlySubs)}<small>/mo</small>`, frac: d.monthlySubs / 500, note: `${d.subs.filter(s => s.monthlyUSD > 0).length} paid plans` }),
      ledMeter({ label: 'Fleet active ≤14d', value: `${d.active}<small> / ${d.tools.length}</small>`, frac: d.active / Math.max(1, d.tools.length), note: `${snap.scan?.dormant?.length ?? 0} dormant installs beyond these` }),
      ledMeter({ label: 'Idle local disk', value: `${d.idleGB.toFixed(0)}<small> GB</small>`, frac: d.idleGB / 200, note: 'Ollama + LM Studio models on disk' }),
    ].join('');
    const last30 = Object.entries(d.cc.byDay || {}).sort().slice(-30)
      .map(([k, v]) => ({ k: k.slice(5), v: v.apiCostUSD || 0, title: usd(v.apiCostUSD, 2) }));
    const alerts = d.alerts.map(a => `<div class="alert ${a.level === 'warn' ? 'warn' : ''}">${a.text}</div>`).join('')
      || '<div class="alert warn">No spend alerts. Fleet clean.</div>';
    return `<h1>Status</h1><p class="h-sub">Machine-wide AI telemetry. Scan ${esc(snap.generatedAt)}</p>
      <div class="bridge">${meters}</div>
      <h2>Daily signal · last 30 days</h2>
      ${barChart(last30, { color: e => e.v > 100 ? 'red' : e.v > 40 ? 'amber' : '' })}
      <h2>Spend alerts</h2>${alerts}`;
  },

  usage(snap) {
    const d = derive(snap);
    const models = Object.entries(d.cc.byModel || {}).sort((a, b) => (b[1].apiCostUSD || 0) - (a[1].apiCostUSD || 0));
    const maxC = Math.max(...models.map(([, v]) => v.apiCostUSD || 0), 0.01);
    const rows = models.map(([m, v]) => `<tr><td>${esc(m)}</td>
      <td class="num">${fmt(v.input + v.cacheWrite5m + v.cacheWrite1h)}</td>
      <td class="num">${fmt(v.cacheRead)}</td><td class="num">${fmt(v.output)}</td>
      <td class="num">${v.calls}</td>
      <td class="num">${usd(v.apiCostUSD, 2)}<span class="hbar ${m.includes('fable') || m.includes('opus') ? 'amber' : ''}" style="width:${Math.round(70 * (v.apiCostUSD || 0) / maxC)}px"></span></td></tr>`).join('');
    const months = Object.entries(d.cc.byMonth || {}).sort().map(([k, v]) => ({ k, v: v.apiCostUSD || 0, title: usd(v.apiCostUSD) }));
    const projects = Object.entries(d.cc.byProject || {}).sort((a, b) => (b[1].apiCostUSD || 0) - (a[1].apiCostUSD || 0)).slice(0, 12)
      .map(([k, v]) => ({ k: k.slice(0, 14), v: v.apiCostUSD || 0, title: usd(v.apiCostUSD) }));
    return `<h1>Data</h1><p class="h-sub">Claude Code transcripts, real token counts, priced at API rates. ${d.cc.sessions} sessions · ${d.cc.userTurns} turns · ${usd(d.cc.apiEquivalentCostUSD)} total equivalent</p>
      <div class="panel"><table><tr><th>Model</th><th class="num">In + cache write</th><th class="num">Cache read</th><th class="num">Out</th><th class="num">Calls</th><th class="num">API cost</th></tr>${rows}</table></div>
      <h2>By month</h2>${barChart(months)}
      <h2>By project</h2>${barChart(projects)}`;
  },

  fleet(snap) {
    const tools = correctedTools(snap).sort((a, b) => (a.daysSinceUse ?? 9999) - (b.daysSinceUse ?? 9999));
    const strips = tools.map(t => {
      const d = t.daysSinceUse;
      const led = d === null ? 'cold' : d <= 14 ? 'on' : d <= 45 ? 'warm' : 'cold';
      const status = d === null ? 'never used' : d === 0 ? 'active today' : `${d}d since use`;
      return `<div class="strip">
        <div class="strip-head"><div class="strip-name">${esc(t.name)}</div><span class="strip-led ${led}"></span></div>
        <div class="strip-meta"><span><b>${esc(status)}</b></span>
          <span>${t.dataMB >= 1024 ? (t.dataMB / 1024).toFixed(1) + ' GB' : t.dataMB + ' MB'} data</span>
          <span>${esc(t.pricing)}</span></div>
        <div class="strip-cat">${esc(t.vendor)} · ${esc(t.category)}</div>
      </div>`;
    }).join('');
    const dormant = (snap.scan?.dormant || []).map(x => `<div>${esc(x.dir)}${x.mb ? ` · ${x.mb} MB` : ''}</div>`).join('');
    return `<h1>Inventory</h1><p class="h-sub">Every harness, IDE, and runtime detected on this machine.</p>
      <div class="strips">${strips}</div>
      <h2>Muted channels · installed, never used (${snap.scan?.dormant?.length ?? 0})</h2>
      <div class="panel" style="padding:16px"><div class="muted-list">${dormant || 'none'}</div></div>`;
  },

  spend(snap) {
    const d = derive(snap);
    const verdict = (s) => {
      if (s.tool === 'claude-code') return '<span class="badge keep">keep</span>';
      if (!s.monthlyUSD) return '<span class="badge">free</span>';
      const idBy = { antigravity: 'antigravity', 'gemini-cli': 'gemini-cli', codex: 'codex', copilot: 'copilot', opencode: 'opencode', ollama: 'ollama', lmstudio: 'lmstudio' };
      const t = d.tools.find(x => x.id === idBy[s.tool]);
      const dd = t?.daysSinceUse;
      if (!t || dd === null || dd > 30) return '<span class="badge cut">cancel candidate</span>';
      if (dd > 14) return '<span class="badge watch">watch</span>';
      return '<span class="badge keep">keep</span>';
    };
    const rows = d.subs.map(s => `<tr><td>${esc(s.tool)}</td><td>${esc(s.plan)}</td>
      <td class="num">${usd(s.monthlyUSD)}</td><td>${verdict(s)}</td></tr>`).join('');
    const cuttable = d.subs.filter(s => s.monthlyUSD && verdict(s).includes('cut')).reduce((a, s) => a + s.monthlyUSD, 0);
    return `<h1>Caps</h1><p class="h-sub">${usd(d.monthlySubs)}/mo declared · ${usd(cuttable)}/mo flagged cuttable (${usd(cuttable * 12)}/yr)</p>
      <div class="panel"><table><tr><th>Tool</th><th>Plan</th><th class="num">Monthly</th><th>Verdict</th></tr>${rows}</table></div>
      <h2>Live usage &amp; remaining</h2>${liveUsageBlock()}
      <h2>Value check</h2>
      <div class="panel"><table>
        <tr><th>Metric</th><th class="num">Value</th></tr>
        <tr><td>Claude plan cost</td><td class="num">${usd(d.claudeSub)}/mo</td></tr>
        <tr><td>API-equivalent pace, this month</td><td class="num">${usd(d.monthPace)}/mo</td></tr>
        <tr><td>Return multiple</td><td class="num">${d.roi === null ? '—' : d.roi.toFixed(1) + '×'}</td></tr>
        <tr><td>All-time API-equivalent (since ${esc((d.cc.firstActivity || '').slice(0, 10))})</td><td class="num">${usd(d.cc.apiEquivalentCostUSD)}</td></tr>
      </table></div>`;
  },

  models(snap) {
    const bench = state.benchmarks || {};
    const agents = state.agents?.agents || [];
    // build rows from the agent registry so we can bench each configured model
    const rows = [];
    for (const a of agents) {
      if (a.runtime !== 'ollama' && a.runtime !== 'lmstudio') continue;
      for (const [id, cfg] of Object.entries(a.models || {})) {
        if (cfg.role === 'embedding') continue;
        const bm = bench[`${a.id}::${id}`];
        rows.push({ agentId: a.id, agent: a.name, model: id, role: cfg.role, sizeGB: a._sizes?.[id],
          loaded: (a._loaded || []).includes(id), bm });
      }
    }
    // fastest by tok/s among benched
    const benched = rows.filter(r => r.bm).sort((a, b) => b.bm.tokPerSec - a.bm.tokPerSec);
    const fastest = benched[0];
    const body = rows.sort((a, b) => (b.bm?.tokPerSec || 0) - (a.bm?.tokPerSec || 0)).map(r => `<tr>
      <td>${esc(r.model)}${r.loaded ? ' <span class="badge ok">loaded</span>' : ''}</td>
      <td>${esc(r.agent)}</td><td>${esc(r.role)}</td>
      <td class="num">${r.sizeGB ? r.sizeGB + ' GB' : '—'}</td>
      <td class="num">${r.bm ? r.bm.ttftMs + ' ms' : '—'}</td>
      <td class="num">${r.bm ? r.bm.tokPerSec + ' t/s' : '—'}</td>
      <td>${r.bm ? esc(r.bm.ranAt.slice(0, 10)) : '—'}</td>
      <td><button class="btn mini" data-bench="${esc(r.agentId)}|${esc(r.model)}">bench</button></td>
    </tr>`).join('');
    return `<h1>Workshop</h1><p class="h-sub">Local models — ${(snap.ollamaGB ?? 0)} GB Ollama + ${(snap.lmstudio?.totalGB ?? 0)} GB LM Studio on disk. Benchmark measures first-token latency and tokens/sec on your hardware.</p>
      ${fastest ? `<div class="alert info">Fastest benched: <b>${esc(fastest.model)}</b> (${esc(fastest.agent)}) at ${fastest.bm.tokPerSec} t/s, ${fastest.bm.ttftMs} ms to first token.</div>` : '<div class="alert info">No benchmarks yet — click "bench" on a model, or "Benchmark all".</div>'}
      <div style="margin:10px 0"><button class="btn" id="bench-all">Benchmark all</button></div>
      <div class="panel"><table><tr><th>Model</th><th>Runtime</th><th>Role</th><th class="num">Size</th><th class="num">First token</th><th class="num">Speed</th><th>Benched</th><th></th></tr>${body}</table></div>`;
  },

  consensus() {
    const runs = state.consensus.runs.map(r => `<details class="run"><summary>${esc(r.id)}</summary><pre>${esc(r.content)}</pre></details>`).join('')
      || '<p class="h-sub">No runs yet.</p>';
    const jobs = state.consensus.jobs.filter(j => j.status === 'running')
      .map(j => `<div class="alert warn">Job ${j.id} running since ${esc(j.startedAt)} — "${esc(j.question.slice(0, 90))}…"</div>`).join('');
    return `<h1>Radio</h1><p class="h-sub">Broadcast one question to every installed engine (Claude, Codex, local Qwen). Answers land below.</p>
      <div class="ask"><input id="ask-q" placeholder="e.g. Should I move bulk coding work to Sonnet and keep Fable for architecture?" />
      <button class="btn" id="ask-btn">Run engines</button></div>
      ${jobs}${runs}`;
  },

  report() {
    return `<h1>Log</h1><p class="h-sub">Latest recommendations, fed by consensus runs.</p>
      <div class="md">${mdRender(state.recs)}</div>`;
  },

  ledger() {
    const snap = state.snap; if (!snap?.claude) return '<h1>Ledger</h1><p class="h-sub">No usage data.</p>';
    const cc = snap.claude, b = state.budget || { monthlyTargetUSD: 0, dailyAlertUSD: 0 };
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const dayOfMonth = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const monthEquiv = cc.byMonth?.[thisMonth]?.apiCostUSD ?? 0;
    const projected = dayOfMonth ? (monthEquiv / dayOfMonth) * daysInMonth : 0;

    const days = Object.entries(cc.byDay || {}).sort().slice(-30).map(([k, v]) => ({ k: k.slice(5), v: v.apiCostUSD || 0 }));
    const months = Object.entries(cc.byMonth || {}).sort().map(([k, v]) => ({ k, v: v.apiCostUSD || 0 }));
    // cumulative
    let run = 0; const cum = Object.entries(cc.byDay || {}).sort().map(([k, v]) => { run += v.apiCostUSD || 0; return { k: k.slice(5), v: run }; }).slice(-30);
    // model mix
    const models = Object.entries(cc.byModel || {}).filter(([m]) => m !== '<synthetic>').sort((a, b) => b[1].apiCostUSD - a[1].apiCostUSD);
    const totalC = models.reduce((a, [, v]) => a + v.apiCostUSD, 0) || 1;

    const todayBurn = cc.byDay?.[now.toISOString().slice(0, 10)]?.apiCostUSD ?? 0;
    const alerts = [];
    if (b.dailyAlertUSD > 0 && todayBurn > b.dailyAlertUSD) alerts.push(`<div class="alert">Today's API-equivalent burn ${usd(todayBurn, 2)} is over your ${usd(b.dailyAlertUSD)}/day alert.</div>`);
    if (b.monthlyTargetUSD > 0 && projected > b.monthlyTargetUSD) alerts.push(`<div class="alert">Projected month-end ${usd(projected)} exceeds your ${usd(b.monthlyTargetUSD)}/mo target.</div>`);
    if (b.monthlyTargetUSD > 0 && projected <= b.monthlyTargetUSD) alerts.push(`<div class="alert info">On track: projected ${usd(projected)} vs ${usd(b.monthlyTargetUSD)}/mo target (${Math.round(projected / b.monthlyTargetUSD * 100)}%).</div>`);

    const modelBars = models.map(([m, v]) => `<tr><td>${esc(m)}</td><td class="num">${usd(v.apiCostUSD, 2)}</td>
      <td class="num">${Math.round(v.apiCostUSD / totalC * 100)}%<span class="hbar ${m.includes('fable') || m.includes('opus') ? 'amber' : ''}" style="width:${Math.round(60 * v.apiCostUSD / totalC)}px"></span></td></tr>`).join('');

    return `<h1>Ledger</h1><p class="h-sub">Spend over time, priced at API rates. All-time equivalent ${usd(cc.apiEquivalentCostUSD)}.</p>
      <div class="bridge">
        <div class="meter-card"><div class="meter-label">This month so far</div><div class="meter-value">${usd(monthEquiv)}</div><div class="meter-note">day ${dayOfMonth} of ${daysInMonth}</div></div>
        <div class="meter-card"><div class="meter-label">Projected month-end</div><div class="meter-value">${usd(projected)}</div><div class="meter-note">at current pace</div></div>
        <div class="meter-card"><div class="meter-label">Today's burn</div><div class="meter-value">${usd(todayBurn)}</div></div>
        <div class="meter-card"><div class="meter-label">Monthly target</div><div class="meter-value">${b.monthlyTargetUSD ? usd(b.monthlyTargetUSD) : '—'}</div><div class="meter-note">set below</div></div>
      </div>
      ${alerts.join('') || '<div class="alert info">No budget alerts. Set thresholds below to enable them.</div>'}
      <h2>Budget thresholds</h2>
      <div class="panel" style="padding:14px"><div class="key-form">
        <label class="strip-meta">Monthly target $ <input id="bud-month" type="number" min="0" value="${b.monthlyTargetUSD || ''}" placeholder="e.g. 400" style="width:120px"></label>
        <label class="strip-meta">Daily alert $ <input id="bud-day" type="number" min="0" value="${b.dailyAlertUSD || ''}" placeholder="e.g. 100" style="width:120px"></label>
        <button class="btn mini" id="bud-save">Save thresholds</button>
      </div></div>
      <h2>Daily API-equivalent burn · last 30d</h2>${lineChart(days)}
      <h2>Cumulative · last 30d</h2>${lineChart(cum, { color: 'var(--amber)' })}
      <h2>Month over month</h2>${barChart(months, { color: e => e.v > 400 ? 'red' : e.v > 200 ? 'amber' : '' })}
      <h2>Model mix (all-time)</h2>
      <div class="panel"><table><tr><th>Model</th><th class="num">Cost</th><th class="num">Share</th></tr>${modelBars}</table></div>`;
  },

  terminal() {
    const t = state.term;
    if (!t.targets) return '<h1>Terminal</h1><p class="h-sub">Loading agents…</p>';
    const avail = t.targets.filter(x => x.available || x.kind === 'cli');
    if (!t.agentId) t.agentId = avail[0]?.id;
    const active = t.targets.find(x => x.id === t.agentId) || avail[0];
    const agentOpts = t.targets.map(x =>
      `<option value="${esc(x.id)}"${x.id === t.agentId ? ' selected' : ''}${!x.available && x.kind === 'local' ? '' : ''}>${esc(x.name)}${x.kind === 'local' && !x.available ? ' (offline — will launch)' : ''}</option>`).join('');
    const modelSel = (active?.models?.length)
      ? `<select id="t-model">${active.models.map(m => `<option value="${esc(m)}"${m === t.model ? ' selected' : ''}>${esc(m)}${(active.loaded || []).includes(m) ? ' (loaded)' : ''}</option>`).join('')}</select>`
      : '<span class="strip-meta">default model</span>';
    const key = t.agentId + '::' + (t.model || 'default');
    const thread = t.threads[key] || [];
    const bubbles = thread.map(m =>
      `<div class="msg ${m.role}"><div class="msg-who">${m.role === 'user' ? 'you' : esc(m.who || active?.name || 'agent')}${m.seconds != null ? ` · ${m.seconds}s` : ''}</div><div class="msg-body">${esc(m.content)}</div></div>`).join('');
    const pending = t.pending ? '<div class="msg assistant"><div class="msg-who">' + esc(active?.name || 'agent') + '</div><div class="msg-body typing">▮ thinking…</div></div>' : '';
    return `<h1>Terminal</h1><p class="h-sub">Direct line to one agent. ${esc(active?.description || '')}</p>
      <div class="term-bar">
        <select id="t-agent">${agentOpts}</select>
        ${modelSel}
        <button class="btn mini" id="t-reset">clear thread</button>
      </div>
      <div class="term-log" id="term-log">${bubbles || '<div class="strip-meta">No messages yet. Say something.</div>'}${pending}</div>
      <div class="ask">
        <input id="t-input" placeholder="message ${esc(active?.name || '')}…" ${t.pending ? 'disabled' : ''} />
        <button class="btn" id="t-send" ${t.pending ? 'disabled' : ''}>Send</button>
      </div>`;
  },

  keyring() {
    const k = state.keys;
    if (!k) return '<h1>Keyring</h1><p class="h-sub">Key store not loaded.</p>';
    const provOpts = Object.entries(k.providers).map(([id, p]) => `<option value="${esc(id)}">${esc(p.label)} → ${esc(p.varName)}</option>`).join('')
      + '<option value="custom">Custom (name your own var)</option>';
    const targetChecks = Object.entries(k.targets).map(([id, t]) =>
      `<label class="tgt"><input type="checkbox" class="push-tgt" value="${esc(id)}"${id === 'agentos' ? ' checked' : ''}> <b>${esc(t.label)}</b><span>${esc(t.desc)}</span></label>`).join('');
    const rows = (k.keys || []).map(key => {
      const pushed = Object.keys(key.pushedTo || {});
      return `<tr>
        <td>${esc(key.label)}</td><td><code>${esc(key.varName)}</code></td>
        <td class="mono">${esc(key.masked)}</td>
        <td>${pushed.length ? pushed.map(p => `<span class="badge ok">${esc(p)}</span>`).join(' ') : '<span class="badge">not pushed</span>'}</td>
        <td><button class="btn mini" data-key-push="${esc(key.id)}">push</button>
            <button class="btn mini" data-key-del="${esc(key.id)}">delete</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5">no keys stored yet</td></tr>';
    return `<h1>Keyring</h1><p class="h-sub">Store API keys once, push them to your agents and harnesses. Keys are held server-side, masked here, never sent back to the browser, and gitignored.</p>
      <div class="alert warn">Secrets are stored in plaintext in <code>config/keys.json</code> on this machine (single-user, gitignored, not web-served). Treat this box as trusted.</div>
      <h2>Add a key</h2>
      <div class="panel" style="padding:16px">
        <div class="key-form">
          <select id="k-provider">${provOpts}</select>
          <input id="k-var" placeholder="ENV_VAR_NAME (custom only)" style="display:none" />
          <input id="k-label" placeholder="label (optional)" />
          <input id="k-value" type="password" placeholder="paste key value" />
          <button class="btn" id="k-add">Store key</button>
        </div>
        <div class="key-targets"><div class="strip-meta" style="margin:10px 0 6px">Default push targets (used by the Push button):</div>${targetChecks}</div>
      </div>
      <h2>Stored keys (${(k.keys || []).length})</h2>
      <div class="panel"><table><tr><th>Label</th><th>Env var</th><th>Value</th><th>Pushed to</th><th>Actions</th></tr>${rows}</table></div>`;
  },

  garage() {
    const a = state.agents;
    if (!a) return '<h1>Garage</h1><p class="h-sub">Agent registry not loaded.</p>';
    const cards = a.agents.map(ag => {
      const running = ag.runtime === 'claude-cli' ? true : ag._running;
      const led = running ? 'on' : 'cold';
      const models = Object.entries(ag.models || {});
      const opts = models.map(([id, cfg]) =>
        `<option value="${esc(id)}"${id === ag.activeModel ? ' selected' : ''}>${esc(id)} · ${esc(cfg.role)}${(ag._loaded || []).includes(id) ? ' (loaded)' : ''}</option>`).join('');
      const controls = ag.runtime === 'claude-cli' ? '<span class="badge ok">orchestrator</span>'
        : `<button class="btn mini" data-act="launch" data-id="${ag.id}">${running ? 'running' : 'launch'}</button>
           <button class="btn mini" data-act="restart" data-id="${ag.id}">restart</button>`;
      const modelPicker = ag.runtime === 'claude-cli' ? '<div class="strip-meta">CLI default model</div>'
        : `<div class="ag-model"><select data-model-for="${ag.id}">${opts}</select>
           <button class="btn mini" data-act="setmodel" data-id="${ag.id}">load</button></div>
           <div class="strip-meta">${models.length} models configured · active: <b>${esc(ag.activeModel || '—')}</b></div>`;
      return `<div class="ag-card">
        <div class="ag-head">
          <input class="ag-name" value="${esc(ag.name)}" data-name-for="${ag.id}" aria-label="agent name" />
          <span class="strip-led ${led}"></span>
        </div>
        <textarea class="ag-desc" data-desc-for="${ag.id}" rows="2" aria-label="agent description">${esc(ag.description || '')}</textarea>
        <div class="ag-ctl">${controls}</div>
        ${modelPicker}
        <div class="ag-status" data-status-for="${ag.id}"></div>
      </div>`;
    }).join('');
    return `<h1>Garage</h1><p class="h-sub">Launch, restart, rename, and re-model every local agent. Edit a name or description and it saves on blur. Model dropdown loads the pick into memory.</p>
      <div class="ag-grid">${cards}</div>`;
  },

  command() {
    const o = state.orch, v = state.vats;
    let body = '';
    // editable plan (after Plan, before Execute)
    if (v.plan && v.catalog) {
      const agentModels = {};
      for (const m of v.catalog) { (agentModels[m.agentId] ||= new Set()).add(m.model); }
      const agentIds = Object.keys(agentModels);
      body += '<h2>Route — edit before dispatch</h2><div class="panel"><table><tr><th class="num">#</th><th>Step</th><th>Agent</th><th>Model</th></tr>';
      v.plan.forEach((s, i) => {
        const aOpts = agentIds.map(a => `<option value="${esc(a)}"${a === s.agent ? ' selected' : ''}>${esc(a)}</option>`).join('');
        const mOpts = [...(agentModels[s.agent] || agentModels[agentIds[0]] || [])].map(m => `<option value="${esc(m)}"${m === s.model ? ' selected' : ''}>${esc(m)}</option>`).join('');
        body += `<tr><td class="num">${i + 1}</td><td>${esc(s.title)}<div class="strip-meta">${esc((s.instruction || '').slice(0, 90))}</div></td>
          <td><select data-step-agent="${i}">${aOpts}</select></td><td><select data-step-model="${i}">${mOpts}</select></td></tr>`;
      });
      body += '</table></div><div style="margin:10px 0"><button class="btn" id="vats-exec">Execute route</button> <button class="btn mini" id="vats-cancel">discard</button></div>';
    }
    if (o) {
      if (o.status === 'running') body += `<div class="alert warn">Running — ${(o.events || []).filter(e => e.type === 'step-done').length} steps done…</div>`;
      const doneSteps = (o.events || []).filter(e => e.type === 'step-done');
      if (doneSteps.length) {
        body += '<h2>Step output</h2>';
        for (const s of doneSteps) body += `<div class="run"><b>${esc(s.title)}</b> — ${esc(s.agent)} / ${esc(s.model)} · ${s.seconds}s ${s.error ? '<span class="badge dead">error</span>' : '<span class="badge ok">ok</span>'}<pre>${esc(s.error || s.output || '')}</pre></div>`;
      }
      const fin = o.result?.final || o.events?.find(e => e.type === 'final')?.final;
      if (fin) body += `<h2>Final answer</h2><div class="md"><pre>${esc(fin)}</pre></div>`;
      if (o.status === 'failed') body += `<div class="alert">Failed: ${esc(o.result?.error || 'unknown')}</div>`;
    }
    // past runs
    const runs = state.orchRuns || [];
    if (runs.length) {
      body += `<h2>Past runs (${runs.length})</h2>`;
      body += runs.slice(0, 12).map(r => `<details class="run"><summary>${esc(r.savedAt?.slice(0, 16).replace('T', ' '))} — ${esc((r.prompt || '').slice(0, 80))}</summary>
        <div class="strip-meta" style="margin:6px 0">${(r.steps || []).map(s => `${esc(s.agent)}/${esc(s.model)} (${s.seconds}s)`).join(' → ')}</div>
        <pre>${esc((r.final || '').slice(0, 1000))}</pre>
        <button class="btn mini" data-rerun="${esc(r.prompt || '')}">re-run this prompt</button></details>`).join('');
    }
    return `<h1>Dispatch</h1><p class="h-sub">Claude plans a route across your agents and models. "Plan" lets you edit the route first; "Plan & run" dispatches immediately.</p>
      <div class="ask"><input id="orch-q" placeholder="e.g. Write a Python function to parse a CSV file, then reason about edge cases, then summarize." />
      <button class="btn" id="vats-plan">Plan</button><button class="btn" id="orch-btn">Plan &amp; run</button></div>
      ${body}`;
  },

  network() {
    const n = state.net;
    if (!n) return '<h1>Map</h1><p class="h-sub">Network scan not loaded.</p>';
    const kindLed = (a) => a.reachable ? 'on' : 'warm';
    const ipLabel = (a) => {
      const parts = [];
      if (a.self) { if (a.lanIP) parts.push(a.lanIP); if (a.tailscaleIP) parts.push(a.tailscaleIP + ' (TS)'); }
      else parts.push(a.ip + (a.tailscaleIP ? ' (TS)' : ''));
      return parts.join(' · ') || a.ip;
    };
    const agentRows = (n.agents || []).map(a => `<tr>
      <td>${esc(a.tool)}</td><td>${esc(a.node)}</td>
      <td>${esc(ipLabel(a))}<span class="badge" style="margin-left:6px">:${a.port}</span></td>
      <td>${esc(a.kind)}</td>
      <td>${a.reachable ? '<span class="badge ok">live</span>' : '<span class="badge stale">port open</span>'}</td>
      <td>${a.models?.length ? esc(a.models.slice(0, 3).join(', ')) + (a.models.length > 3 ? ` +${a.models.length - 3}` : '') : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6">no agent services discovered</td></tr>';

    const peerRows = (n.tailscale?.peers || []).map(p => `<tr>
      <td>${esc(p.host)}${p.self ? '<span class="badge ok" style="margin-left:6px">this machine</span>' : ''}</td>
      <td>${esc(p.ip || '—')}</td><td>${esc(p.os || '?')}</td>
      <td>${p.online ? '<span class="badge ok">online</span>' : '<span class="badge dead">offline</span>'}</td>
      <td>${p.online || !p.lastSeen ? '—' : esc(new Date(p.lastSeen).toISOString().slice(0, 10))}</td>
    </tr>`).join('') || '<tr><td colspan="5">tailscale not detected</td></tr>';

    const exposed = (n.otherExposed || []).map(l => `<tr><td class="num">${l.port}</td><td>${esc(l.addr)}</td><td>${esc(l.proc)}</td></tr>`).join('')
      || '<tr><td colspan="3">none</td></tr>';

    const ips = n.localIPs || {};
    const banner = `<div class="alert info">This machine — LAN <b>${esc(ips.lan || '?')}</b>${ips.tailscale ? ` · Tailscale <b>${esc(ips.tailscale)}</b>` : ''}. ${n.tailscale?.online ?? 0}/${n.tailscale?.total ?? 0} mesh nodes online. ${n.lanScanned ? 'Full LAN swept.' : 'LAN sweep off — <a href="#" id="lan-scan" style="color:var(--phos)">run full local-subnet scan</a>.'}</div>`;

    return `<h1>Map</h1><p class="h-sub">Agent services across this machine and the Tailscale mesh, each labeled with its address. Probed ${esc(n.generatedAt.slice(11, 19))} UTC.</p>
      ${banner}
      <h2>Agents on the network</h2>
      <div class="panel"><table><tr><th>Service</th><th>Node</th><th>Address</th><th>Kind</th><th>State</th><th>Models</th></tr>${agentRows}</table></div>
      <h2>Tailscale mesh</h2>
      <div class="panel"><table><tr><th>Node</th><th>Tailscale IP</th><th>OS</th><th>State</th><th>Last seen</th></tr>${peerRows}</table></div>
      <h2>Other exposed ports (this machine)</h2>
      <div class="panel"><table><tr><th class="num">Port</th><th>Bind</th><th>Process</th></tr>${exposed}</table></div>`;
  },

  perks() {
    const c = state.caps;
    if (!c) return '<h1>Perks</h1><p class="h-sub">Capability scan not loaded yet.</p>';
    const inv = c.inventories, u = c.usage;
    const useBadge = (entry) => {
      if (!entry?.count) return '<span class="badge dead">unused</span>';
      const d = entry.lastUsed ? Math.floor((Date.now() - new Date(entry.lastUsed)) / 86400000) : null;
      if (d !== null && d <= 14) return '<span class="badge ok">active</span>';
      if (d !== null && d <= 45) return '<span class="badge stale">stale</span>';
      return '<span class="badge dead">cold</span>';
    };
    const lastOf = (entry) => entry?.lastUsed ? entry.lastUsed.slice(0, 10) : '—';

    // directives (recommendations) — executable ones get a run button
    const recRows = (c.recommendations || []).map((r, i) => {
      const btn = r.exec ? `<button class="btn mini rec-run" data-verb="${esc(r.exec.verb)}" data-target="${esc(r.exec.target)}" data-i="${i}">▶ ${esc(r.exec.label)}</button>` : '';
      return `<div class="alert ${r.kind === 'remove' ? '' : r.kind === 'audit' ? 'warn' : 'info'}">
        <span class="rec-kind ${r.kind}">${r.kind}</span> ${esc(r.text)} ${btn}
        <span class="rec-out" data-out="${i}"></span></div>`;
    }).join('') || '<div class="alert info">No directives. Loadout clean.</div>';

    // claude plugins
    const cx = new Set((inv.codex?.plugins || []).filter(p => p.enabled).map(p => p.name));
    const plugRows = (inv.claude?.plugins || []).map(p => {
      const e = u.plugins[p.name];
      return `<tr><td>${esc(p.name)}</td><td>${esc(p.version || '?')}</td>
        <td>${(p.provides || []).join(', ') || '—'}</td>
        <td class="num">${e?.count ?? 0}</td><td>${lastOf(e)}</td>
        <td>${useBadge(e)}</td><td>${cx.has(p.name) ? '<span class="badge ok">also in codex</span>' : '<span class="badge">claude only</span>'}</td></tr>`;
    }).join('');

    // skills: union of installed user skills and every skill seen in transcripts
    const skillNames = new Set([...(inv.claude?.skills || []), ...Object.keys(u.skills)]);
    const skillRows = [...skillNames].map(s => ({ s, e: u.skills[s] }))
      .sort((a, b) => (b.e?.count ?? 0) - (a.e?.count ?? 0)).slice(0, 40)
      .map(({ s, e }) => `<tr><td>${esc(s)}</td>
        <td>${(inv.claude?.skills || []).includes(s) ? 'user-installed' : s.includes(':') ? 'plugin' : 'bundled'}</td>
        <td class="num">${e?.count ?? 0}</td><td>${lastOf(e)}</td><td>${useBadge(e)}</td></tr>`).join('');

    // mcp servers observed in transcripts + configured
    const mcpNames = new Set([...(inv.claude?.mcpServers || []).map(m => m.name), ...Object.keys(u.mcp)]);
    const mcpRows = [...mcpNames].map(n => ({ n, e: u.mcp[n] }))
      .sort((a, b) => (b.e?.count ?? 0) - (a.e?.count ?? 0)).slice(0, 40)
      .map(({ n, e }) => {
        const pretty = n.length > 30 && /^[0-9a-f-]{30,}$/.test(n) ? n.slice(0, 8) + '… (claude.ai connector)' : n;
        return `<tr><td>${esc(pretty)}</td><td class="num">${e?.count ?? 0}</td><td>${lastOf(e)}</td><td>${useBadge(e)}</td></tr>`;
      }).join('');

    // subagents
    const agentRows = Object.entries(u.agents).sort((a, b) => b[1].count - a[1].count)
      .map(([n, e]) => `<tr><td>${esc(n)}</td><td class="num">${e.count}</td><td>${lastOf(e)}</td><td>${useBadge(e)}</td></tr>`).join('');

    // codex side
    const cl = new Set((inv.claude?.plugins || []).map(p => p.name));
    const codexRows = (inv.codex?.plugins || []).map(p =>
      `<tr><td>${esc(p.name)}</td><td>${esc(p.marketplace)}</td>
       <td>${p.enabled ? '<span class="badge ok">enabled</span>' : '<span class="badge">off</span>'}</td>
       <td>${cl.has(p.name) ? '<span class="badge ok">also in claude</span>' : '<span class="badge">codex only</span>'}</td></tr>`).join('');
    const codexMcp = (inv.codex?.mcpServers || []).map(s => esc(s.name)).join(', ') || 'none';
    const gemini = inv.gemini
      ? `${inv.gemini.mcpServers.length} MCP servers, ${inv.gemini.extensions.length} extensions configured`
      : 'not installed';

    return `<h1>Perks</h1><p class="h-sub">Skills, plugins, MCP servers, subagents — what each harness carries, what actually gets used, what should be shared or scrapped. Usage measured from real Claude Code transcripts.</p>
      <h2>Directives</h2>${recRows}
      <h2>Claude Code · plugins (${inv.claude?.plugins?.length ?? 0})</h2>
      <div class="panel"><table><tr><th>Plugin</th><th>Ver</th><th>Provides</th><th class="num">Uses</th><th>Last used</th><th>Status</th><th>Parity</th></tr>${plugRows}</table></div>
      <h2>Claude Code · skills (top 40 by use)</h2>
      <div class="panel"><table><tr><th>Skill</th><th>Source</th><th class="num">Uses</th><th>Last used</th><th>Status</th></tr>${skillRows}</table></div>
      <h2>Claude Code · MCP servers observed</h2>
      <div class="panel"><table><tr><th>Server</th><th class="num">Tool calls</th><th>Last used</th><th>Status</th></tr>${mcpRows}</table></div>
      <h2>Claude Code · subagents</h2>
      <div class="panel"><table><tr><th>Agent type</th><th class="num">Spawns</th><th>Last used</th><th>Status</th></tr>${agentRows || '<tr><td colspan="4">none recorded</td></tr>'}</table></div>
      <h2>Codex · plugins (${inv.codex?.plugins?.length ?? 0})</h2>
      <div class="panel"><table><tr><th>Plugin</th><th>Marketplace</th><th>State</th><th>Parity</th></tr>${codexRows || '<tr><td colspan="4">none</td></tr>'}</table></div>
      <p class="h-sub" style="margin-top:10px">Codex MCP servers: ${codexMcp} · Gemini: ${esc(gemini)}</p>
      ${harnessUsageBlock()}`;
  },
};

/* ---------- router / boot ---------- */
function currentPage() {
  const h = location.hash.replace('#/', '') || 'overview';
  return pages[h] ? h : 'overview';
}

function render() {
  const page = currentPage();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  if (!state.snap) { main.innerHTML = '<div class="loading">Reading the board…</div>'; return; }
  // preserve in-progress form input and open <details> across re-renders
  const drafts = {}; let focusId = document.activeElement?.id || null;
  for (const el of main.querySelectorAll('input[id], textarea[id]')) drafts[el.id] = el.value;
  const open = new Set([...main.querySelectorAll('details[open] > summary')].map(s => s.textContent));
  main.innerHTML = pages[page](state.snap);
  if (page === 'consensus') wireConsensus();
  for (const [id, val] of Object.entries(drafts)) {
    const el = document.getElementById(id);
    if (el && val && el.tagName === 'INPUT' && el.type !== 'submit') el.value = val;
  }
  if (focusId) document.getElementById(focusId)?.focus?.();
  main.querySelectorAll('details').forEach(d => {
    if (open.has(d.querySelector('summary')?.textContent)) d.open = true;
  });
  const lanLink = $('#lan-scan');
  if (lanLink) lanLink.addEventListener('click', async (e) => {
    e.preventDefault();
    lanLink.textContent = 'sweeping 254 hosts…';
    try { state.net = await api('/api/network?lan=1'); render(); } catch { lanLink.textContent = 'sweep failed'; }
  });
  if (page === 'garage') wireGarage();
  if (page === 'command') wireCommand();
  if (page === 'perks') wirePerks();
  if (page === 'keyring') wireKeyring();
  if (page === 'terminal') wireTerminal();
  if (page === 'ledger') wireLedger();
  if (page === 'models') wireWorkshop();
  if (page === 'command') wireVats();
  $('#stamp').textContent = 'scan ' + (state.snap.generatedAt || '').replace('T', ' ').slice(0, 19);
}

function wireConsensus() {
  $('#ask-btn')?.addEventListener('click', async () => {
    const q = $('#ask-q').value.trim();
    if (!q) return;
    $('#ask-btn').disabled = true;
    try {
      const { jobId } = await api('/api/consensus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) });
      pollJob(jobId);
      state.consensus.jobs.push({ id: jobId, status: 'running', startedAt: new Date().toISOString(), question: q });
      $('#ask-q').value = ''; // submitted — clear the draft so render doesn't restore it
      render();
    } catch (e) {
      alert('failed: ' + e.message);
    } finally {
      const btn = $('#ask-btn');
      if (btn) btn.disabled = false;
    }
  });
}

async function pollJob(id) {
  const t = setInterval(async () => {
    try {
      const job = await api('/api/consensus/jobs/' + id);
      if (job.status !== 'running') {
        clearInterval(t);
        state.consensus = await api('/api/consensus');
        if (currentPage() === 'consensus') render();
      }
    } catch { clearInterval(t); }
  }, 5000);
}

function post(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function wireGarage() {
  const setStatus = (id, msg, cls = '') => { const el = document.querySelector(`[data-status-for="${id}"]`); if (el) el.innerHTML = `<span class="badge ${cls}">${esc(msg)}</span>`; };
  document.querySelectorAll('.ag-name').forEach(inp => inp.addEventListener('blur', async () => {
    const id = inp.dataset.nameFor; await post('/api/agents/rename', { id, name: inp.value }).catch(() => {});
  }));
  document.querySelectorAll('.ag-desc').forEach(t => t.addEventListener('blur', async () => {
    const id = t.dataset.descFor; await post('/api/agents/describe', { id, description: t.value }).catch(() => {});
  }));
  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id, act = btn.dataset.act;
    btn.disabled = true;
    try {
      if (act === 'launch') { setStatus(id, 'launching…', 'stale'); const r = await post('/api/agents/launch', { id }); setStatus(id, r.ok ? (r.alreadyRunning ? 'already running' : 'started') : 'failed: ' + (r.error || ''), r.ok ? 'ok' : 'dead'); }
      else if (act === 'restart') { setStatus(id, 'restarting…', 'stale'); const r = await post('/api/agents/restart', { id }); setStatus(id, r.ok ? 'restarted' : 'failed: ' + (r.error || ''), r.ok ? 'ok' : 'dead'); }
      else if (act === 'setmodel') {
        const sel = document.querySelector(`[data-model-for="${id}"]`); const model = sel.value;
        setStatus(id, 'loading ' + model + '…', 'stale');
        const r = await post('/api/agents/model', { id, model });
        setStatus(id, r.ok ? 'active: ' + r.activeModel : 'failed: ' + (r.error || ''), r.ok ? 'ok' : 'dead');
      }
      state.agents = await api('/api/agents').catch(() => state.agents);
    } finally { btn.disabled = false; }
  }));
}

function wireLedger() {
  $('#bud-save')?.addEventListener('click', async () => {
    const monthlyTargetUSD = parseFloat($('#bud-month').value) || 0;
    const dailyAlertUSD = parseFloat($('#bud-day').value) || 0;
    state.budget = await post('/api/budget', { monthlyTargetUSD, dailyAlertUSD }).catch(() => state.budget);
    render();
  });
}

function wireWorkshop() {
  document.querySelectorAll('[data-bench]').forEach(b => b.addEventListener('click', async () => {
    const [agentId, model] = b.dataset.bench.split('|');
    b.disabled = true; b.textContent = 'benching…';
    const r = await post('/api/benchmark', { agentId, model }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok) state.benchmarks = (await api('/api/benchmark').catch(() => ({ results: state.benchmarks }))).results;
    else { b.textContent = 'failed'; b.title = r.error || ''; }
    render();
  }));
  $('#bench-all')?.addEventListener('click', async () => {
    const btn = $('#bench-all'); btn.disabled = true; btn.textContent = 'benchmarking all (slow)…';
    try {
      const { jobId } = await post('/api/benchmark', { all: true });
      const t = setInterval(async () => {
        const job = await api('/api/benchmark/jobs/' + jobId).catch(() => null);
        if (!job) return;
        const done = (job.events || []).filter(e => e.type === 'bench-done').length;
        const total = (job.events || []).find(e => e.total)?.total || '?';
        btn.textContent = `benchmarking ${done}/${total}…`;
        if (job.status !== 'running') { clearInterval(t); state.benchmarks = (await api('/api/benchmark')).results; render(); }
      }, 3000);
    } catch { btn.disabled = false; btn.textContent = 'Benchmark all'; }
  });
}

function wireTerminal() {
  const t = state.term;
  if (!t.targets) {
    api('/api/chat/targets').then(r => { t.targets = r.targets; if (currentPage() === 'terminal') render(); }).catch(() => { t.targets = []; render(); });
    return;
  }
  const agentSel = $('#t-agent'), modelSel = $('#t-model'), input = $('#t-input');
  const log = $('#term-log');
  if (log) log.scrollTop = log.scrollHeight;
  agentSel?.addEventListener('change', () => {
    t.agentId = agentSel.value;
    const active = t.targets.find(x => x.id === t.agentId);
    t.model = active?.models?.[0] || null;
    render();
  });
  modelSel?.addEventListener('change', () => { t.model = modelSel.value; render(); });
  $('#t-reset')?.addEventListener('click', () => {
    const key = t.agentId + '::' + (t.model || 'default');
    delete t.threads[key]; render();
  });
  const send = async () => {
    if (t.pending) return;
    const text = input.value.trim(); if (!text) return;
    const active = t.targets.find(x => x.id === t.agentId);
    const model = t.model || active?.models?.[0] || null;
    const key = t.agentId + '::' + (t.model || 'default');
    t.threads[key] = t.threads[key] || [];
    t.threads[key].push({ role: 'user', content: text });
    t.pending = true; input.value = ''; render();
    try {
      const { jobId } = await post('/api/chat', { agentId: t.agentId, model, messages: t.threads[key].map(m => ({ role: m.role, content: m.content })) });
      pollChat(jobId, key, active?.name);
    } catch (e) {
      t.threads[key].push({ role: 'assistant', content: 'error: ' + e.message, who: active?.name });
      t.pending = false; render();
    }
  };
  $('#t-send')?.addEventListener('click', send);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  if (input && !t.pending) input.focus();
}

async function pollChat(id, key, who) {
  const t = state.term;
  const timer = setInterval(async () => {
    try {
      const job = await api('/api/chat/jobs/' + id);
      if (job.status === 'running') return;
      clearInterval(timer);
      const r = job.result || {};
      t.threads[key] = t.threads[key] || [];
      t.threads[key].push({ role: 'assistant', content: r.ok ? r.reply : ('error: ' + (r.error || 'failed')), who, seconds: r.seconds });
      t.pending = false;
      if (currentPage() === 'terminal') render();
    } catch { clearInterval(timer); t.pending = false; if (currentPage() === 'terminal') render(); }
  }, 2000);
}

function wireKeyring() {
  const prov = $('#k-provider'), varInp = $('#k-var');
  if (prov) prov.addEventListener('change', () => { varInp.style.display = prov.value === 'custom' ? '' : 'none'; });
  const selectedTargets = () => [...document.querySelectorAll('.push-tgt:checked')].map(c => c.value);
  $('#k-add')?.addEventListener('click', async () => {
    const provider = prov.value, value = $('#k-value').value.trim(), label = $('#k-label').value.trim();
    const varName = provider === 'custom' ? varInp.value.trim() : undefined;
    if (!value) return alert('paste a key value');
    const r = await post('/api/keys', { provider, value, label, varName });
    if (!r.ok) return alert('failed: ' + (r.error || ''));
    state.keys = await api('/api/keys').catch(() => state.keys); render();
  });
  document.querySelectorAll('[data-key-push]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.keyPush; const targets = selectedTargets();
    if (!targets.length) return alert('tick at least one push target in the Add-a-key box first');
    b.disabled = true; b.textContent = 'pushing…';
    const r = await post('/api/keys/push', { id, targets }).catch(e => ({ ok: false, error: e.message }));
    const msg = r.results ? Object.entries(r.results).map(([t, x]) => `${t}: ${x.ok ? 'ok' + (x.note ? ' (' + x.note + ')' : '') : 'FAIL ' + x.error}`).join('\n') : (r.error || 'failed');
    alert(msg);
    state.keys = await api('/api/keys').catch(() => state.keys); render();
  }));
  document.querySelectorAll('[data-key-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this key from the store? (does not remove it from where it was already pushed)')) return;
    await post('/api/keys/remove', { id: b.dataset.keyDel }).catch(() => {});
    state.keys = await api('/api/keys').catch(() => state.keys); render();
  }));
}

function wirePerks() {
  document.querySelectorAll('.rec-run').forEach(btn => btn.addEventListener('click', async () => {
    const verb = btn.dataset.verb, target = btn.dataset.target;
    const out = document.querySelector(`[data-out="${btn.dataset.i}"]`);
    if (!confirm(`Run: claude plugin ${verb} ${target}?\n\n${verb === 'disable' ? 'Reversible — you can re-enable it anytime.' : 'Enables the plugin if it is installed.'}`)) return;
    btn.disabled = true;
    if (out) out.innerHTML = ' <span class="badge stale">running…</span>';
    try {
      const r = await post('/api/directive/execute', { verb, target });
      if (out) out.innerHTML = r.ok ? ` <span class="badge ok">done: ${esc(r.output || verb + 'd')}</span>` : ` <span class="badge dead">${esc(r.error || 'failed')}</span>`;
      if (r.ok) { btn.textContent = verb === 'disable' ? '✓ disabled' : '✓ enabled'; state.caps = await api('/api/capabilities?refresh=1').catch(() => state.caps); }
      else btn.disabled = false;
    } catch (e) { if (out) out.innerHTML = ` <span class="badge dead">${esc(e.message)}</span>`; btn.disabled = false; }
  }));
}

function wireCommand() {
  const btn = $('#orch-btn'), inp = $('#orch-q');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const prompt = inp.value.trim(); if (!prompt) return;
    btn.disabled = true;
    try {
      const { jobId } = await post('/api/orchestrate', { prompt });
      state.orch = { status: 'running', prompt, events: [] }; state.vats.plan = null;
      inp.value = ''; render();
      pollOrch(jobId);
    } catch (e) { alert('dispatch failed: ' + e.message); btn.disabled = false; }
  });
}

function wireVats() {
  const v = state.vats;
  $('#vats-plan')?.addEventListener('click', async () => {
    const prompt = $('#orch-q').value.trim(); if (!prompt) return;
    const b = $('#vats-plan'); b.disabled = true; b.textContent = 'planning…';
    const r = await post('/api/orchestrate/plan', { prompt }).catch(e => ({ ok: false, error: e.message }));
    if (r.ok) { v.plan = r.plan; v.catalog = r.catalog; v.prompt = prompt; state.orch = null; }
    else alert('plan failed: ' + (r.error || ''));
    render();
  });
  document.querySelectorAll('[data-step-agent]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.stepAgent; v.plan[i].agent = sel.value;
    const models = v.catalog.filter(m => m.agentId === sel.value).map(m => m.model);
    if (!models.includes(v.plan[i].model)) v.plan[i].model = models[0];
    render();
  }));
  document.querySelectorAll('[data-step-model]').forEach(sel => sel.addEventListener('change', () => {
    v.plan[+sel.dataset.stepModel].model = sel.value;
  }));
  $('#vats-exec')?.addEventListener('click', async () => {
    const b = $('#vats-exec'); b.disabled = true;
    const { jobId } = await post('/api/orchestrate/execute', { prompt: v.prompt, plan: v.plan });
    state.orch = { status: 'running', prompt: v.prompt, events: [] }; v.plan = null;
    render(); pollOrch(jobId);
  });
  $('#vats-cancel')?.addEventListener('click', () => { v.plan = null; render(); });
  document.querySelectorAll('[data-rerun]').forEach(b => b.addEventListener('click', async () => {
    const prompt = b.dataset.rerun; const { jobId } = await post('/api/orchestrate', { prompt });
    state.orch = { status: 'running', prompt, events: [] }; render(); pollOrch(jobId);
  }));
}

async function pollOrch(id) {
  const t = setInterval(async () => {
    try {
      const job = await api('/api/orchestrate/jobs/' + id);
      state.orch = job;
      if (job.status !== 'running') {
        clearInterval(t);
        state.orchRuns = (await api('/api/orchestrate/runs').catch(() => ({ runs: state.orchRuns }))).runs;
      }
      if (currentPage() === 'command') render();
    } catch { clearInterval(t); }
  }, 2500);
}

async function loadAll({ refresh = false } = {}) {
  try {
    setLive(null);
    const [snap, history, recs, consensus, caps, net, usageLive] = await Promise.all([
      api('/api/snapshot' + (refresh ? '?refresh=1' : '')),
      api('/api/history'),
      api('/api/recommendations'),
      api('/api/consensus'),
      api('/api/capabilities' + (refresh ? '?refresh=1' : '')),
      api('/api/network' + (refresh ? '?refresh=1' : '')),
      api('/api/usage-live' + (refresh ? '?refresh=1' : '')),
    ]);
    if (snap?.error) throw new Error(snap.error);
    state.snap = snap; state.history = history; state.recs = recs.markdown; state.consensus = consensus;
    state.caps = caps; state.net = net; state.usageLive = usageLive;
    state.agents = await api('/api/agents').catch(() => null);
    state.keys = await api('/api/keys').catch(() => null);
    state.budget = await api('/api/budget').catch(() => null);
    state.benchmarks = (await api('/api/benchmark').catch(() => ({ results: {} }))).results;
    state.orchRuns = (await api('/api/orchestrate/runs').catch(() => ({ runs: [] }))).runs;
    state.harness = await api('/api/harness-usage').catch(() => null);
    setLive(true);
    render();
  } catch (e) {
    setLive(false);
    main.innerHTML = `<div class="alert">Server unreachable: ${esc(e.message)}. Start it with <code>node server.mjs</code>.</div>`;
  }
}

$('#refresh-btn').addEventListener('click', async () => {
  $('#refresh-btn').disabled = true;
  await loadAll({ refresh: true });
  $('#refresh-btn').disabled = false;
});
// lite mode — persisted, applied before first paint
function applyLite(on) {
  document.body.classList.toggle('lite', on);
  const b = $('#lite-btn'); if (b) b.textContent = on ? 'CRT mode' : 'Lite mode';
  localStorage.setItem('agentos-lite', on ? '1' : '0');
}
$('#lite-btn')?.addEventListener('click', () => applyLite(!document.body.classList.contains('lite')));
applyLite(localStorage.getItem('agentos-lite') === '1');

window.addEventListener('hashchange', render);
loadAll();
setInterval(() => {
  // don't clobber the page while typing, or while an orchestration job is live
  const t = document.activeElement?.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || state.orch?.status === 'running') return;
  loadAll();
}, 5 * 60 * 1000);
