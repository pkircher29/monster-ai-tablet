import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Each engine: binary + argv builder. No shell — the prompt travels as a single argument.
const ENGINES = [
  { id: 'claude',  bin: 'claude', args: (p) => ['-p', p, '--model', 'haiku'], timeout: 300000 },
  { id: 'codex',   bin: 'codex',  args: (p) => ['exec', p], timeout: 300000 },
  { id: 'gemini',  bin: 'gemini', args: (p) => ['-p', p], timeout: 300000 },
  // set AISPY_OLLAMA_MODEL to any model you've pulled (`ollama list`); defaults to llama3.1
  { id: 'ollama',  bin: 'ollama', args: (p) => ['run', process.env.AISPY_OLLAMA_MODEL || 'llama3.1', p], timeout: 420000 },
];

// cmd.exe still parses metacharacters even with argv arrays under shell:true.
// Questions are natural language; stripping shell-significant chars loses nothing.
const sanitize = (q) => q.replace(/[`"^&|<>%!\\;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);

export function runConsensus(rawQuestion, { engines = null } = {}) {
  const question = sanitize(rawQuestion);
  const roster = engines ? ENGINES.filter(e => engines.includes(e.id)) : ENGINES;
  const answers = [];
  for (const e of roster) {
    const started = Date.now();
    // shell:true only to resolve .ps1/.cmd shims on Windows PATH
    const r = spawnSync(e.bin, e.args(question), {
      encoding: 'utf8', timeout: e.timeout, windowsHide: true,
      shell: process.platform === 'win32',
    });
    const ok = r.status === 0 && !r.error;
    answers.push({
      engine: e.id, ok, seconds: Math.round((Date.now() - started) / 1000),
      answer: (r.stdout || '').trim() || null,
      error: ok ? undefined : ((r.stderr || '') + (r.error ? String(r.error) : '')).slice(0, 500),
    });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(ROOT, 'data', 'consensus');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${stamp}.md`);
  const md = [`# Consensus run — ${stamp}`, '', `**Question:** ${question}`, '',
    ...answers.map(a => `## ${a.engine} (${a.ok ? 'ok' : 'FAILED'}, ${a.seconds}s)\n\n${a.answer || a.error || '(no output)'}\n`)].join('\n');
  writeFileSync(file, md);
  return { file, answers };
}
