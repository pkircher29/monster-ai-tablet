import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentState, routableModels } from './agents.mjs';
import { ROLE_HINTS } from './model-catalog.mjs';
import { launch, setModel } from './control.mjs';

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'orchestrations');

const clean = (s) => String(s).replace(/[`"^&|<>%!\\;]/g, ' ').replace(/\s+/g, ' ').trim();

function claude(prompt, { model = 'sonnet', timeout = 300000 } = {}) {
  const r = spawnSync('claude', ['-p', clean(prompt), '--model', model], {
    encoding: 'utf8', timeout, windowsHide: true, shell: process.platform === 'win32', maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0 && !r.stdout) throw new Error((r.stderr || r.error?.message || 'claude failed').slice(0, 300));
  return (r.stdout || '').trim();
}

async function localChat(endpoint, model, system, user, timeout = 240000) {
  const r = await fetch(endpoint + '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1536, stream: false, temperature: 0.4 }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`${model} @ ${endpoint} -> HTTP ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() || '(empty response)';
}

function parsePlan(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function catalogForRouting() {
  const reg = await buildAgentState();
  return { reg, catalog: routableModels(reg).filter(m => m.role !== 'embedding') };
}

// Phase 1 — Claude plans the route (no execution). Returns an editable plan.
export async function planTask(rawPrompt) {
  const prompt = String(rawPrompt || '').slice(0, 6000);
  const { catalog } = await catalogForRouting();
  const menu = catalog.map(m =>
    `- agent="${m.agentId}" model="${m.model}" role=${m.role} (${ROLE_HINTS[m.role] || 'general'})${m.running === false ? ' [server offline]' : ''}: ${m.description}`
  ).join('\n');

  const planPrompt =
`You are the orchestrator for a fleet of local AI agents. Break the user's task into 1-5 sequential steps and assign each step to the single best agent+model from the menu. Prefer local agents (ollama, lmstudio) for the work; reserve the claude agent for planning/synthesis or steps that truly need frontier reasoning. Match role to task: coder for code, reasoning for logic/math, vision for images, general otherwise. Avoid offline servers if an online option fits.

MENU:
${menu}

USER TASK: ${prompt}

Reply with ONLY a JSON array, no prose. Each element: {"title": short step name, "agent": agentId, "model": model string, "instruction": what this agent should do for this step}. Keep instructions self-contained.`;

  let planText;
  try { planText = claude(planPrompt); } catch (e) { return { ok: false, error: 'planner failed: ' + e.message }; }
  let plan = parsePlan(planText);
  if (!plan || !Array.isArray(plan) || !plan.length) {
    const fb = catalog.find(m => m.running && m.role === 'general') || catalog.find(m => m.running) || catalog[0];
    plan = [{ title: 'Answer', agent: fb?.agentId || 'claude', model: fb?.model || 'sonnet', instruction: prompt }];
  }
  return { ok: true, prompt, plan: plan.slice(0, 5), catalog };
}

// Phase 2 — execute a (possibly user-edited) plan.
export async function executePlan(rawPrompt, plan, { onEvent = () => {} } = {}) {
  const prompt = String(rawPrompt || '').slice(0, 6000);
  const reg = await buildAgentState();
  onEvent({ type: 'plan', plan });
  const steps = [];
  let context = '';
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const agent = reg.agents.find(a => a.id === step.agent) || reg.agents.find(a => a.runtime === 'claude-cli');
    onEvent({ type: 'step-start', index: i, title: step.title, agent: agent?.name, model: step.model });
    const started = Date.now();
    let output, error = null;
    const sys = `You are "${agent?.name}" performing step ${i + 1} of ${plan.length}: ${step.title}. Be direct and complete. If prior context is given, build on it.`;
    const user = context ? `PRIOR STEPS OUTPUT:\n${context}\n\n---\nYOUR INSTRUCTION: ${step.instruction}` : step.instruction;
    try {
      if (!agent || agent.runtime === 'claude-cli') {
        output = claude(`${sys}\n\n${user}`, { model: /opus|sonnet|haiku|fable/.test(step.model) ? step.model : 'sonnet' });
      } else {
        if (agent.port) { const up = await launch(agent.id); if (!up.ok) throw new Error(`could not start ${agent.name}`); }
        if (agent.runtime === 'lmstudio' && !(agent._loaded || []).includes(step.model)) {
          onEvent({ type: 'step-note', index: i, text: `loading ${step.model}…` });
          await setModel(agent.id, step.model).catch(() => {});
        }
        output = await localChat(agent.endpoint, step.model, sys, user);
      }
    } catch (e) { error = String(e.message || e).slice(0, 300); output = null; }
    const rec = { index: i, title: step.title, agent: agent?.name, agentId: agent?.id, model: step.model, seconds: Math.round((Date.now() - started) / 1000), output, error };
    steps.push(rec);
    onEvent({ type: 'step-done', ...rec });
    if (output) context += `\n[${step.title} — ${agent?.name}/${step.model}]\n${output}\n`;
  }

  let final = null;
  const good = steps.filter(s => s.output);
  if (good.length > 1) {
    onEvent({ type: 'phase', text: 'Synthesizing…' });
    try { final = claude(`You orchestrated these steps for the user task "${prompt}". Synthesize one clear, complete final answer. Do not mention the internal steps unless relevant.\n\nSTEPS:\n${context}`); }
    catch { final = good[good.length - 1].output; }
  } else if (good.length === 1) final = good[0].output;
  onEvent({ type: 'final', final });
  const result = { ok: true, prompt, plan, steps, final };
  saveRun(result);
  return result;
}

// plan + execute in one shot (backward compatible)
export async function runOrchestration(prompt, { onEvent = () => {} } = {}) {
  onEvent({ type: 'phase', text: 'Claude is planning the route…' });
  const p = await planTask(prompt);
  if (!p.ok) return { ok: false, error: p.error };
  return executePlan(prompt, p.plan, { onEvent });
}

function saveRun(result) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `${stamp}.json`), JSON.stringify({ ...result, savedAt: new Date().toISOString() }, null, 2));
  } catch {}
}

export function listRuns(limit = 30) {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit).map(f => {
    try {
      const r = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8'));
      return { id: f.replace('.json', ''), savedAt: r.savedAt, prompt: r.prompt,
        steps: (r.steps || []).map(s => ({ title: s.title, agent: s.agent, model: s.model, seconds: s.seconds, ok: !!s.output })),
        final: r.final };
    } catch { return null; }
  }).filter(Boolean);
}
