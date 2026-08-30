#!/usr/bin/env node
// Agent OS — track, analyze, and optimize every AI tool/harness on this machine.
// Usage:
//   node agentos.mjs scan        detect installed AI tools + activity
//   node agentos.mjs usage       parse Claude Code / Codex / local-model usage
//   node agentos.mjs report      full snapshot -> data/snapshot.json + dashboard.html + REPORT.md
//   node agentos.mjs consensus "question" [engines]   ask claude,codex,gemini,ollama; engines comma-list optional
import { scanTools } from './lib/scan.mjs';
import { analyzeClaudeUsage } from './lib/claude-usage.mjs';
import { analyzeCodex, analyzeOllama, analyzeLMStudio, analyzeGemini } from './lib/other-usage.mjs';
import { writeSnapshot, writeDashboard, writeMarkdownReport } from './lib/report.mjs';
import { runConsensus } from './lib/consensus.mjs';
import { buildSnapshot } from './lib/snapshot.mjs';

const cmd = process.argv[2] || 'report';

if (cmd === 'scan') {
  console.log(JSON.stringify(scanTools(), null, 2));
} else if (cmd === 'usage') {
  console.log(JSON.stringify({ claude: analyzeClaudeUsage(), codex: analyzeCodex(), ollama: analyzeOllama(), lmstudio: analyzeLMStudio(), gemini: analyzeGemini() }, null, 2));
} else if (cmd === 'report') {
  const snap = buildSnapshot();
  const sFile = writeSnapshot(snap);
  const dFile = writeDashboard(snap);
  let recs = '';
  try { recs = (await import('node:fs')).readFileSync(new URL('./data/recommendations.md', import.meta.url), 'utf8'); } catch {}
  const rFile = writeMarkdownReport(snap, recs);
  console.log('snapshot:', sFile);
  console.log('dashboard:', dFile);
  console.log('report:', rFile);
} else if (cmd === 'consensus') {
  const question = process.argv[3];
  if (!question) { console.error('usage: node agentos.mjs consensus "question" [claude,codex,gemini,ollama]'); process.exit(1); }
  const engines = process.argv[4] ? process.argv[4].split(',') : null;
  const { file, answers } = runConsensus(question, { engines });
  for (const a of answers) console.log(`[${a.engine}] ${a.ok ? 'ok' : 'FAILED'} in ${a.seconds}s`);
  console.log('saved:', file);
} else {
  console.error('unknown command:', cmd);
  process.exit(1);
}
