import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { costUSD } from './pricing.mjs';

// Claude Code encodes a project's cwd into its dir name by replacing path separators with "-".
// Strip this machine's home-dir prefix generically so project labels aren't user-specific.
const HOME_ENC = homedir().replace(/[:\\/]/g, '-').replace(/^-+/, '');

const emptyUsage = () => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, calls: 0, cost: 0 });

function addUsage(agg, u, cost) {
  agg.input += u.input; agg.output += u.output;
  agg.cacheWrite5m += u.cacheWrite5m; agg.cacheWrite1h += u.cacheWrite1h;
  agg.cacheRead += u.cacheRead; agg.calls += 1; agg.cost += cost;
}

// Parse every Claude Code transcript under ~/.claude/projects.
// Dedups on message.id (streaming writes several lines per API message with identical usage).
export function analyzeClaudeUsage() {
  const projDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(projDir)) return null;

  const byModel = {}, byProject = {}, byDay = {}, byMonth = {};
  const sessions = new Set();
  const seenMsg = new Set();
  const seenUser = new Set(); // resumed/compacted sessions re-log prior user turns
  let firstTs = null, lastTs = null, userTurns = 0;

  for (const proj of readdirSync(projDir)) {
    const pDir = join(projDir, proj);
    let files;
    try { files = readdirSync(pDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      let text;
      try { text = readFileSync(join(pDir, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec.sessionId) sessions.add(rec.sessionId);
        if (rec.timestamp) {
          if (!firstTs || rec.timestamp < firstTs) firstTs = rec.timestamp;
          if (!lastTs || rec.timestamp > lastTs) lastTs = rec.timestamp;
        }
        if (rec.type === 'user' && !rec.isSidechain && rec.message?.role === 'user'
            && typeof rec.message.content === 'string'
            && (!rec.uuid || !seenUser.has(rec.uuid))) {
          if (rec.uuid) seenUser.add(rec.uuid);
          userTurns++;
        }
        if (rec.type !== 'assistant' || !rec.message?.usage) continue;
        const id = rec.message.id;
        if (id && seenMsg.has(id)) continue;
        if (id) seenMsg.add(id);

        const mu = rec.message.usage;
        const u = {
          input: mu.input_tokens || 0,
          output: mu.output_tokens || 0,
          cacheWrite5m: mu.cache_creation?.ephemeral_5m_input_tokens ?? (mu.cache_creation ? 0 : (mu.cache_creation_input_tokens || 0)),
          cacheWrite1h: mu.cache_creation?.ephemeral_1h_input_tokens || 0,
          cacheRead: mu.cache_read_input_tokens || 0,
        };
        const model = rec.message.model || 'unknown';
        const day = (rec.timestamp || '').slice(0, 10) || 'unknown';
        const month = day.slice(0, 7);
        const project = proj.replace(HOME_ENC, '').replace(/^-+/, '') || 'home';

        const recCost = costUSD(model, u); // exact per-record cost -> every bucket is exact
        for (const [map, key] of [[byModel, model], [byProject, project], [byDay, day], [byMonth, month]]) {
          if (!map[key]) map[key] = emptyUsage();
          addUsage(map[key], u, recCost);
        }
      }
    }
  }

  const finalize = (map) => Object.fromEntries(
    Object.entries(map).map(([k, v]) => {
      const { cost, ...rest } = v;
      return [k, { ...rest, apiCostUSD: +cost.toFixed(2) }];
    })
  );
  const totalCost = Object.values(byModel).reduce((a, v) => a + v.cost, 0);

  return {
    sessions: sessions.size,
    userTurns,
    firstActivity: firstTs,
    lastActivity: lastTs,
    apiEquivalentCostUSD: +totalCost.toFixed(2),
    byModel: finalize(byModel),
    byProject: finalize(byProject),
    byDay: finalize(byDay),
    byMonth: finalize(byMonth),
  };
}
