import { spawnSync } from 'node:child_process';

// Execute a directive's mapped action. Deliberately narrow: the only actions permitted are
// `claude plugin disable <name>` and `claude plugin enable <name>` — both reversible, both
// operating on a validated plugin name. No arbitrary commands, no file deletion, no codex edits.
const ALLOWED_VERBS = new Set(['disable', 'enable']);
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,64}$/i;

export function executeDirective({ verb, target }) {
  if (!ALLOWED_VERBS.has(verb)) return { ok: false, error: `verb "${verb}" not permitted` };
  if (!target || !NAME_RE.test(target)) return { ok: false, error: 'invalid plugin name' };
  const r = spawnSync('claude', ['plugin', verb, target], {
    encoding: 'utf8', timeout: 30000, windowsHide: true, shell: process.platform === 'win32',
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 600);
  if (r.status === 0) return { ok: true, verb, target, output: out || `${verb}d ${target}` };
  return { ok: false, verb, target, error: out || r.error?.message || `claude plugin ${verb} failed`, reversible: true };
}
