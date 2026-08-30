import { spawnSync } from 'node:child_process';
import { buildAgentState } from './agents.mjs';
import { launch } from './control.mjs';

const clean = (s) => String(s).replace(/[`"^&|<>%!\\;]/g, ' ').replace(/\s+/g, ' ').trim();

function onPath(cli) {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cli], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0;
  } catch { return false; }
}

// which agents/harnesses can be chatted with, and their selectable models
export async function chatTargets() {
  const reg = await buildAgentState();
  const targets = [];

  targets.push({ id: 'claude', name: 'Claude', kind: 'cli', available: onPath('claude'),
    models: ['sonnet', 'opus', 'haiku', 'fable'], description: 'Anthropic Claude via CLI. Frontier reasoning, planning, code.' });
  if (onPath('codex')) targets.push({ id: 'codex', name: 'Codex', kind: 'cli', available: true, models: [], description: 'OpenAI Codex CLI. Code-focused agent.' });
  if (onPath('gemini')) targets.push({ id: 'gemini', name: 'Gemini', kind: 'cli', available: true, models: [], description: 'Google Gemini CLI.' });

  for (const a of reg.agents) {
    if (a.runtime !== 'ollama' && a.runtime !== 'lmstudio') continue;
    const models = Object.entries(a.models || {}).filter(([, c]) => c.role !== 'embedding').map(([id]) => id);
    targets.push({ id: a.id, name: a.name, kind: 'local', available: !!a._running, endpoint: a.endpoint,
      models, description: a.description, loaded: a._loaded || [] });
  }
  return targets;
}

// flatten a message history into a single prompt for single-shot CLI harnesses
function flatten(messages, latest) {
  const prior = messages.slice(0, -1).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  return (prior ? `Ongoing conversation — reply only as the assistant's next message, no preamble.\n\n${prior}\n\n` : '') + `User: ${latest}`;
}

async function localChat(endpoint, model, messages, timeout = 240000) {
  const r = await fetch(endpoint + '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 2048, stream: false, temperature: 0.7 }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${model}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() || '(empty response)';
}

// args must already include the (sanitized) prompt in the correct position
function cliChat(bin, args, timeout = 300000) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8', timeout, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0 && !r.stdout) throw new Error((r.stderr || r.error?.message || bin + ' failed').slice(0, 300));
  return (r.stdout || '').trim() || '(no output)';
}

// messages: [{role:'user'|'assistant', content}], last one is the newest user turn
export async function chatOnce({ agentId, model, messages }) {
  if (!Array.isArray(messages) || !messages.length) return { ok: false, error: 'no messages' };
  const latest = messages[messages.length - 1]?.content || '';
  const targets = await chatTargets();
  const t = targets.find(x => x.id === agentId);
  if (!t) return { ok: false, error: 'unknown agent' };
  if (!t.available && t.kind === 'local') { const l = await launch(agentId); if (!l.ok) return { ok: false, error: `${t.name} is not running` }; }

  const started = Date.now();
  try {
    let reply;
    if (t.kind === 'local') {
      const m = model && t.models.includes(model) ? model : (t.models[0]);
      if (!m) return { ok: false, error: 'no model available' };
      reply = await localChat(t.endpoint, m, messages);
    } else if (agentId === 'claude') {
      const m = ['sonnet', 'opus', 'haiku', 'fable'].includes(model) ? model : 'sonnet';
      reply = cliChat('claude', ['-p', clean(flatten(messages, latest)), '--model', m]);
    } else if (agentId === 'codex') {
      reply = cliChat('codex', ['exec', clean(flatten(messages, latest))]);
    } else if (agentId === 'gemini') {
      reply = cliChat('gemini', ['-p', clean(flatten(messages, latest))]);
    } else {
      return { ok: false, error: 'unsupported agent' };
    }
    return { ok: true, reply, seconds: Math.round((Date.now() - started) / 1000), model: model || null };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300), seconds: Math.round((Date.now() - started) / 1000) };
  }
}
