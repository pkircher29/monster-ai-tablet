import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'config', 'keys.json');

// provider -> canonical env var name. 'custom' lets the user name their own var.
export const PROVIDERS = {
  anthropic:  { varName: 'ANTHROPIC_API_KEY',  label: 'Anthropic (Claude)' },
  openai:     { varName: 'OPENAI_API_KEY',     label: 'OpenAI' },
  openrouter: { varName: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
  gemini:     { varName: 'GEMINI_API_KEY',     label: 'Google Gemini' },
  groq:       { varName: 'GROQ_API_KEY',       label: 'Groq' },
  deepseek:   { varName: 'DEEPSEEK_API_KEY',   label: 'DeepSeek' },
  mistral:    { varName: 'MISTRAL_API_KEY',    label: 'Mistral' },
  xai:        { varName: 'XAI_API_KEY',        label: 'xAI (Grok)' },
  huggingface:{ varName: 'HF_TOKEN',           label: 'Hugging Face' },
  firecrawl:  { varName: 'FIRECRAWL_API_KEY',  label: 'Firecrawl' },
};

// where a key can be pushed. env writers only — no config-file parsing/merging.
export const TARGETS = {
  'agentos':   { label: 'Agent OS (this server, live now)', desc: 'Live usage panels read the key immediately.' },
  'user-env':  { label: 'Windows user environment', desc: 'setx — every CLI/harness reading env picks it up in new shells (Claude Code, Codex, etc.).' },
  'hermes':    { label: 'Hermes (~/.hermes/.env)', desc: 'Appends/updates the key line in Hermes’ env file.' },
};

function load() {
  if (!existsSync(STORE)) { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify({ keys: [] }, null, 2)); }
  try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return { keys: [] }; }
}
function save(db) { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify(db, null, 2)); }

const mask = (v) => v && v.length > 8 ? '••••' + v.slice(-4) : '••••';

// public list — never returns the raw secret
export function listKeys() {
  const db = load();
  return db.keys.map(k => ({
    id: k.id, provider: k.provider, label: k.label, varName: k.varName,
    masked: mask(k.value), createdAt: k.createdAt, pushedTo: k.pushedTo || {},
  }));
}

let seq = 0;
export function addKey({ provider, label, value, varName }) {
  if (!value || typeof value !== 'string' || value.length < 4) return { ok: false, error: 'value required' };
  const p = PROVIDERS[provider];
  const vn = varName || p?.varName;
  if (!vn || !/^[A-Z][A-Z0-9_]{1,64}$/.test(vn)) return { ok: false, error: 'invalid env var name' };
  const db = load();
  const id = 'k' + Date.now().toString(36) + (seq++).toString(36);
  db.keys.push({ id, provider: provider || 'custom', label: label || p?.label || provider || vn, varName: vn, value: value.trim(), createdAt: new Date().toISOString(), pushedTo: {} });
  save(db);
  return { ok: true, id };
}

export function removeKey(id) {
  const db = load();
  const n = db.keys.length;
  db.keys = db.keys.filter(k => k.id !== id);
  if (db.keys.length === n) return { ok: false, error: 'not found' };
  save(db);
  return { ok: true };
}

// write VAR=value into ~/.hermes/.env, replacing any existing line for that var
function pushHermes(varName, value) {
  const f = join(homedir(), '.hermes', '.env');
  try {
    let lines = existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/) : [];
    lines = lines.filter(l => !new RegExp(`^\\s*${varName}\\s*=`).test(l));
    lines = lines.filter(Boolean);
    lines.push(`${varName}=${value}`);
    writeFileSync(f, lines.join('\n') + '\n');
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}

export function pushKey(id, targets) {
  const db = load();
  const k = db.keys.find(x => x.id === id);
  if (!k) return { ok: false, error: 'no such key' };
  const results = {};
  for (const t of (targets || [])) {
    if (t === 'agentos') {
      process.env[k.varName] = k.value; // live in this process — usage panels pick it up now
      results[t] = { ok: true };
    } else if (t === 'user-env') {
      try {
        const r = spawnSync('setx', [k.varName, k.value], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        results[t] = r.status === 0 ? { ok: true, note: 'set for new shells' } : { ok: false, error: (r.stderr || 'setx failed').slice(0, 120) };
      } catch (e) { results[t] = { ok: false, error: String(e).slice(0, 120) }; }
    } else if (t === 'hermes') {
      results[t] = pushHermes(k.varName, k.value);
    } else {
      results[t] = { ok: false, error: 'unknown target' };
    }
    if (results[t].ok) { k.pushedTo = k.pushedTo || {}; k.pushedTo[t] = new Date().toISOString(); }
  }
  save(db);
  return { ok: Object.values(results).some(r => r.ok), results };
}
