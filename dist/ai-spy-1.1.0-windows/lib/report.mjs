import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadSubscriptions() {
  const p = join(ROOT, 'config', 'subscriptions.json');
  const example = join(ROOT, 'config', 'subscriptions.example.json');
  // first run: seed the (gitignored) real config from the shipped template
  if (!existsSync(p) && existsSync(example)) {
    try { writeFileSync(p, readFileSync(example, 'utf8')); } catch {}
  }
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { subscriptions: [], apiKeys: [] }; }
}

export function writeSnapshot(snapshot) {
  const dataDir = join(ROOT, 'data');
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'snapshot.json');
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  // keep dated history for trend tracking across runs
  const dated = join(dataDir, `snapshot-${snapshot.generatedAt.slice(0, 10)}.json`);
  writeFileSync(dated, JSON.stringify(snapshot));
  return file;
}

const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);

export function writeDashboard(snapshot) {
  const file = join(ROOT, 'dashboard.html');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Agent OS — AI Tool Dashboard</title>
<style>
  :root { --bg:#0f1115; --card:#181b22; --fg:#e6e6e6; --dim:#8b93a3; --acc:#4da3ff; --warn:#ffb74d; --bad:#ef5350; --ok:#66bb6a; }
  body { background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,Segoe UI,sans-serif; margin:0; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:16px; margin:24px 0 8px; color:var(--acc); }
  .sub { color:var(--dim); margin-bottom:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
  .card { background:var(--card); border-radius:10px; padding:14px 16px; }
  .big { font-size:26px; font-weight:600; } .lbl { color:var(--dim); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  table { border-collapse:collapse; width:100%; background:var(--card); border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:8px 12px; border-bottom:1px solid #262a33; } th { color:var(--dim); font-weight:500; font-size:12px; text-transform:uppercase; }
  tr:last-child td { border-bottom:none; } td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .bar { height:8px; border-radius:4px; background:var(--acc); display:inline-block; vertical-align:middle; }
  .stale { color:var(--warn); } .dead { color:var(--bad); } .active { color:var(--ok); }
  .pill { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; background:#262a33; color:var(--dim); margin-left:6px; }
</style></head><body>
<h1>Agent OS</h1>
<div class="sub">AI tool usage &amp; spend — generated <span id="gen"></span></div>
<div class="grid" id="kpis"></div>
<h2>Claude Code — usage by model (API-equivalent cost)</h2><div id="models"></div>
<h2>Claude Code — monthly trend</h2><div id="months"></div>
<h2>Claude Code — by project</h2><div id="projects"></div>
<h2>Installed AI tools</h2><div id="tools"></div>
<h2>Local models on disk</h2><div id="local"></div>
<h2>Subscriptions (edit config/subscriptions.json)</h2><div id="subs"></div>
<script>
const S = ${JSON.stringify(snapshot)};
const $ = (id) => document.getElementById(id);
const fmt = (n) => n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n);
const usd = (n) => '$'+(n??0).toLocaleString(undefined,{maximumFractionDigits:2});
$('gen').textContent = S.generatedAt;
const cc = S.claude;
const monthlySubs = (S.subscriptions?.subscriptions||[]).reduce((a,s)=>a+(s.monthlyUSD||0),0);
const kpis = [
  ['Claude sessions', cc?.sessions ?? '—'],
  ['User turns', cc?.userTurns ?? '—'],
  ['API-equivalent value', usd(cc?.apiEquivalentCostUSD)],
  ['Declared subscriptions /mo', usd(monthlySubs)],
  ['AI tools installed', S.scan.tools.length + S.scan.dormant.length],
  ['Actively used (≤14d)', S.scan.tools.filter(t=>t.daysSinceUse!==null&&t.daysSinceUse<=14).length],
  ['Local model disk', ((S.lmstudio?.totalGB??0) + (S.ollamaGB??0)).toFixed(0)+' GB'],
];
$('kpis').innerHTML = kpis.map(([l,v])=>'<div class="card"><div class="lbl">'+l+'</div><div class="big">'+v+'</div></div>').join('');
function table(rows, headers, id){ $(id).innerHTML = '<table><tr>'+headers.map(h=>'<th'+(h[1]?' class="num"':'')+'>'+h[0]+'</th>').join('')+'</tr>'+rows.join('')+'</table>'; }
if (cc) {
  const maxCost = Math.max(...Object.values(cc.byModel).map(v=>v.apiCostUSD||0), 0.01);
  table(Object.entries(cc.byModel).sort((a,b)=>b[1].apiCostUSD-a[1].apiCostUSD).map(([m,v])=>
    '<tr><td>'+m+'</td><td class="num">'+fmt(v.input+v.cacheWrite5m+v.cacheWrite1h)+'</td><td class="num">'+fmt(v.cacheRead)+'</td><td class="num">'+fmt(v.output)+'</td><td class="num">'+v.calls+'</td><td class="num">'+usd(v.apiCostUSD)+' <span class="bar" style="width:'+Math.round(60*v.apiCostUSD/maxCost)+'px"></span></td></tr>'),
    [['Model'],['Input+cache-write',1],['Cache read',1],['Output',1],['API calls',1],['API cost',1]], 'models');
  table(Object.entries(cc.byMonth).sort().map(([m,v])=>
    '<tr><td>'+m+'</td><td class="num">'+fmt(v.output)+'</td><td class="num">'+v.calls+'</td><td class="num">'+usd(v.apiCostUSD)+'</td></tr>'),
    [['Month'],['Output tokens',1],['API calls',1],['Est. cost',1]], 'months');
  table(Object.entries(cc.byProject).sort((a,b)=>b[1].apiCostUSD-a[1].apiCostUSD).slice(0,15).map(([p,v])=>
    '<tr><td>'+(p||'home')+'</td><td class="num">'+fmt(v.output)+'</td><td class="num">'+v.calls+'</td><td class="num">'+usd(v.apiCostUSD)+'</td></tr>'),
    [['Project'],['Output tokens',1],['API calls',1],['Est. cost',1]], 'projects');
}
table(S.scan.tools.sort((a,b)=>(a.daysSinceUse??9999)-(b.daysSinceUse??9999)).map(t=>{
  const d = t.daysSinceUse; const cls = d===null?'dead':d<=14?'active':d<=45?'stale':'dead';
  const status = d===null?'never used':d===0?'today':d+'d ago';
  return '<tr><td>'+t.name+'<span class="pill">'+t.category+'</span></td><td>'+t.vendor+'</td><td class="'+cls+'">'+status+'</td><td class="num">'+t.dataMB.toLocaleString()+' MB</td><td>'+t.pricing+'</td></tr>';
}), [['Tool'],['Vendor'],['Last used'],['Data',1],['Pricing']], 'tools');
const localRows = [];
for (const m of (S.ollama?.models||[])) localRows.push('<tr><td>'+m.name+'</td><td>Ollama</td><td class="num">'+m.size+'</td><td>'+m.modified+'</td></tr>');
for (const m of (S.lmstudio?.models||[])) localRows.push('<tr><td>'+m.name+'</td><td>LM Studio</td><td class="num">'+m.sizeGB+' GB</td><td>'+m.lastUsed+'</td></tr>');
table(localRows, [['Model'],['Runtime'],['Size',1],['Last touched']], 'local');
table((S.subscriptions?.subscriptions||[]).map(s=>'<tr><td>'+s.tool+'</td><td>'+s.plan+'</td><td class="num">'+usd(s.monthlyUSD)+'</td></tr>'),
  [['Tool'],['Plan'],['Monthly',1]], 'subs');
</script></body></html>`;
  writeFileSync(file, html);
  return file;
}

export function writeMarkdownReport(snapshot, recommendations) {
  const file = join(ROOT, 'REPORT.md');
  const cc = snapshot.claude;
  const lines = [
    `# Agent OS Report — ${snapshot.generatedAt.slice(0, 10)}`,
    '',
    '## Headline numbers',
    `- Claude Code: **${cc?.sessions ?? 0} sessions**, ${cc?.userTurns ?? 0} user turns, API-equivalent value **$${cc?.apiEquivalentCostUSD ?? 0}**`,
    `- Codex: ${snapshot.codex?.sessions ?? 0} sessions, last used ${snapshot.codex?.lastActivity?.slice(0, 10) ?? 'never'}`,
    `- Local models: ${(snapshot.ollama?.count ?? 0)} Ollama + ${(snapshot.lmstudio?.models?.length ?? 0)} LM Studio (${((snapshot.lmstudio?.totalGB ?? 0) + (snapshot.ollamaGB ?? 0)).toFixed(0)} GB disk)`,
    `- AI tools installed: ${snapshot.scan.tools.length} with data + ${snapshot.scan.dormant.length} dormant/empty`,
    '',
    '## Claude Code cost by model (API-equivalent)',
    '| Model | Output tokens | Calls | API cost |',
    '|---|---:|---:|---:|',
    ...Object.entries(cc?.byModel ?? {}).sort((a, b) => b[1].apiCostUSD - a[1].apiCostUSD)
      .map(([m, v]) => `| ${m} | ${fmt(v.output)} | ${v.calls} | $${v.apiCostUSD} |`),
    '',
    recommendations || '',
  ];
  writeFileSync(file, lines.join('\n'));
  return file;
}
