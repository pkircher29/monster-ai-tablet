import { spawnSync } from 'node:child_process';

// Query real usage/remaining where a provider exposes it programmatically.
// Only OpenRouter and the Anthropic API return machine-readable quota; everything
// else lives behind an authenticated web dashboard and is reported honestly as such.

async function openrouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { provider: 'openrouter', available: false, note: 'set OPENROUTER_API_KEY to read live credit balance' };
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { provider: 'openrouter', available: false, note: `API returned ${r.status}` };
    const j = (await r.json()).data || {};
    const used = j.usage ?? null;
    const limit = j.limit ?? null; // null = unlimited/pay-as-you-go
    return {
      provider: 'openrouter', available: true,
      usedUSD: used, limitUSD: limit,
      remainingUSD: limit === null ? null : +(limit - used).toFixed(4),
      isFreeTier: !!j.is_free_tier,
      note: limit === null ? 'pay-as-you-go (no hard cap); usage is lifetime spend on this key' : null,
    };
  } catch (e) { return { provider: 'openrouter', available: false, note: String(e).slice(0, 120) }; }
}

// Anthropic API exposes rate limits (not subscription quota) via response headers on a cheap call.
async function anthropicRateLimits() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { provider: 'anthropic-api', available: false, note: 'no ANTHROPIC_API_KEY; Claude Max/Pro subscription quota is not exposed by any API — check claude.ai' };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'x' }] }),
      signal: AbortSignal.timeout(8000),
    });
    const h = (n) => r.headers.get(n);
    const limits = {
      requestsLimit: h('anthropic-ratelimit-requests-limit'),
      requestsRemaining: h('anthropic-ratelimit-requests-remaining'),
      inputTokensLimit: h('anthropic-ratelimit-input-tokens-limit'),
      inputTokensRemaining: h('anthropic-ratelimit-input-tokens-remaining'),
      outputTokensLimit: h('anthropic-ratelimit-output-tokens-limit'),
      outputTokensRemaining: h('anthropic-ratelimit-output-tokens-remaining'),
      resetsAt: h('anthropic-ratelimit-requests-reset'),
    };
    const any = Object.values(limits).some(Boolean);
    return { provider: 'anthropic-api', available: any, scope: 'per-minute rate limits (API key), not subscription quota', limits, note: any ? null : 'no rate-limit headers returned' };
  } catch (e) { return { provider: 'anthropic-api', available: false, note: String(e).slice(0, 120) }; }
}

// Local runtimes: "usage" = models present + running. No quota concept.
async function ollamaLive() {
  try {
    const [tags, ps] = await Promise.all([
      fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null),
      fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null),
    ]);
    if (!tags) return { provider: 'ollama', available: false, note: 'not running' };
    return {
      provider: 'ollama', available: true, running: true,
      modelsInstalled: (tags.models || []).length,
      loadedNow: (ps?.models || []).map(m => m.name),
      note: 'local — no quota; usage = disk + compute',
    };
  } catch { return { provider: 'ollama', available: false, note: 'not running' }; }
}

async function lmstudioLive() {
  try {
    const r = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { provider: 'lmstudio', available: false, note: 'not running' };
    const j = await r.json();
    return { provider: 'lmstudio', available: true, running: true, modelsLoaded: (j.data || []).map(m => m.id), note: 'local — no quota' };
  } catch { return { provider: 'lmstudio', available: false, note: 'not running' }; }
}

// Providers with no programmatic quota API — honest pointers to where the number lives.
const DASHBOARD_ONLY = [
  { provider: 'claude-max', label: 'Claude Max (Claude Code)', note: 'subscription weekly/5h limits are not exposed by API', where: 'https://claude.ai/settings/usage' },
  { provider: 'chatgpt-plus', label: 'ChatGPT Plus (Codex)', note: 'message/usage caps not exposed by API', where: 'https://chatgpt.com/#settings' },
  { provider: 'google-ai', label: 'Google AI (Gemini)', note: 'quota visible in AI Studio / Cloud console', where: 'https://aistudio.google.com/app/apikey' },
  { provider: 'opencode', label: 'OpenCode', note: 'no public usage API', where: 'provider dashboard' },
];

export async function buildSubscriptionUsage() {
  const [or, anth, oll, lms] = await Promise.all([openrouter(), anthropicRateLimits(), ollamaLive(), lmstudioLive()]);
  return {
    generatedAt: new Date().toISOString(),
    live: [or, anth, oll, lms],
    dashboardOnly: DASHBOARD_ONLY,
  };
}
