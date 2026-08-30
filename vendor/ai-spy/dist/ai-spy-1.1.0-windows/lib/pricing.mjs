// API pricing per million tokens (cached from Anthropic docs 2026-07).
// Cache write: 1.25x input (5m TTL), 2x input (1h TTL). Cache read: 0.1x input.
export const PRICING = {
  'claude-fable-5':    { in: 10.0, out: 50.0 },
  'claude-mythos-5':   { in: 10.0, out: 50.0 },
  'claude-opus-4-8':   { in: 5.0,  out: 25.0 },
  'claude-opus-4-7':   { in: 5.0,  out: 25.0 },
  'claude-opus-4-6':   { in: 5.0,  out: 25.0 },
  'claude-opus-4-5':   { in: 5.0,  out: 25.0 },
  'claude-sonnet-5':   { in: 3.0,  out: 15.0 },
  'claude-sonnet-4-6': { in: 3.0,  out: 15.0 },
  'claude-sonnet-4-5': { in: 3.0,  out: 15.0 },
  'claude-haiku-4-5':  { in: 1.0,  out: 5.0 },
};

export function priceFor(model) {
  if (PRICING[model]) return PRICING[model];
  const m = model || '';
  if (m.includes('fable') || m.includes('mythos')) return { in: 10, out: 50 };
  if (m.includes('opus')) return { in: 5, out: 25 };
  if (m.includes('sonnet')) return { in: 3, out: 15 };
  if (m.includes('haiku')) return { in: 1, out: 5 };
  return { in: 3, out: 15 }; // unknown model, assume mid-tier
}

// usage: {input, output, cacheWrite5m, cacheWrite1h, cacheRead} token counts
export function costUSD(model, u) {
  const p = priceFor(model);
  return (
    (u.input        / 1e6) * p.in +
    (u.output       / 1e6) * p.out +
    (u.cacheWrite5m / 1e6) * p.in * 1.25 +
    (u.cacheWrite1h / 1e6) * p.in * 2.0 +
    (u.cacheRead    / 1e6) * p.in * 0.1
  );
}
