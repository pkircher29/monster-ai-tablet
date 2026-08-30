import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { chatOnce } from './chat.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data', 'consensus');

function ensureDir(p) {
  if (!existsSync(p)) {
    try { mkdirSync(p, { recursive: true }); } catch {}
  }
}

const sanitize = (q) => String(q).replace(/[`"^&|<>%!\\;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);

export function generateSuggestedFollowups(question, answers) {
  const qLower = (question || '').toLowerCase();
  if (qLower.includes('model') || qLower.includes('sonnet') || qLower.includes('opus') || qLower.includes('fable')) {
    return [
      'What are the latency and cost differences between these models under high concurrency?',
      'Can we set up an automated fallback to a cheaper model if the task complexity is low?',
      'How should we structure prompts to maximize accuracy on the smaller model?'
    ];
  }
  if (qLower.includes('code') || qLower.includes('refactor') || qLower.includes('architecture')) {
    return [
      'Could you provide a concrete code snippet demonstrating this pattern?',
      'What are the main edge cases and failure modes we need to test for?',
      'How does this architecture scale when adding 10+ autonomous subagents?'
    ];
  }
  if (qLower.includes('mcp') || qLower.includes('tool') || qLower.includes('skill')) {
    return [
      'How do we share this tool definition across Claude, Hermes, and Gemini without rewriting?',
      'What permission boundaries and rate limits should be applied to these tools?',
      'How can we benchmark execution speed across different agent runtimes?'
    ];
  }
  return [
    'What is the immediate first step to implement this recommendation?',
    'What are the trade-offs in terms of speed, cost, and maintainability?',
    'How should we measure and verify success after rolling this out?'
  ];
}

export async function runConsensus(rawQuestion, { engines = null, parentRunId = null, priorContext = null } = {}) {
  const question = sanitize(rawQuestion);
  const targetEngines = engines || ['claude', 'hermes', 'codex', 'ollama'];
  const answers = [];

  for (const eng of targetEngines) {
    const started = Date.now();
    let prompt = question;
    if (priorContext) {
      prompt = `Context of prior discussion: "${priorContext}"\n\nFollow-up Question: "${question}"\nPlease provide your direct technical perspective:`;
    }

    try {
      const res = await chatOnce({ agentId: eng, prompt });
      answers.push({
        engine: eng,
        ok: true,
        seconds: res.seconds || Math.max(1, Math.round((Date.now() - started) / 1000)),
        answer: res.reply || `[${eng} perspective recorded]`
      });
    } catch (e) {
      answers.push({
        engine: eng,
        ok: false,
        seconds: Math.max(1, Math.round((Date.now() - started) / 1000)),
        answer: null,
        error: String(e.message || e)
      });
    }
  }

  ensureDir(DATA_DIR);
  const stamp = parentRunId ? parentRunId : new Date().toISOString().replace(/[:.]/g, '-');
  const runFile = join(DATA_DIR, `${stamp}.json`);

  let runData = {
    id: stamp,
    createdAt: new Date().toISOString(),
    originalQuestion: question,
    turns: []
  };

  if (parentRunId && existsSync(runFile)) {
    try {
      runData = JSON.parse(readFileSync(runFile, 'utf8'));
    } catch {}
  }

  const suggestedFollowups = generateSuggestedFollowups(question, answers);

  const turn = {
    turnIndex: runData.turns.length + 1,
    question,
    timestamp: new Date().toISOString(),
    answers,
    suggestedFollowups
  };

  runData.turns.push(turn);
  runData.updatedAt = new Date().toISOString();

  // Save JSON
  writeFileSync(runFile, JSON.stringify(runData, null, 2), 'utf8');

  // Also write/update Markdown for backwards compatibility & direct viewing
  const mdFile = join(DATA_DIR, `${stamp}.md`);
  const mdSections = runData.turns.map(t => [
    `## Turn ${t.turnIndex}: ${t.question}`,
    `*Timestamp: ${t.timestamp}*`,
    '',
    ...t.answers.map(a => `### ${a.engine.toUpperCase()} (${a.ok ? 'ok' : 'FAILED'}, ${a.seconds}s)\n\n${a.answer || a.error || '(no output)'}\n`)
  ].join('\n')).join('\n---\n\n');

  const mdContent = `# Consensus Broadcast — ${stamp}\n\n**Initial Topic:** ${runData.originalQuestion}\n\n${mdSections}`;
  writeFileSync(mdFile, mdContent, 'utf8');

  return { ok: true, file: runFile, run: runData };
}
