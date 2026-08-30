// Curated capability descriptions for local + cloud models. Keyed by substring match on the
// model id (first match wins), so quantization/tag suffixes still resolve. Falls back to a
// heuristic by family when nothing matches — every model always gets a description + role.

const RULES = [
  { m: /qwen.*coder|coder.*qwen|claude-coder/i, role: 'coder',     desc: 'Code generation, refactors, and tool-use. Strong at following implementation specs.' },
  { m: /deepseek-r1|r1-distill/i,               role: 'reasoning', desc: 'Chain-of-thought reasoning and math. Slower; use when correctness beats speed.' },
  { m: /qwen3-vl|-vl\b|vision|llava/i,          role: 'vision',    desc: 'Image understanding — screenshots, diagrams, photos. Multimodal input.' },
  { m: /qwen3|qwen2/i,                          role: 'general',   desc: 'Solid all-round instruction following. Good default for general chat and drafting.' },
  { m: /gpt-oss/i,                              role: 'general',   desc: 'Large open general model. Broad knowledge; heavier to run.' },
  { m: /blenderllm|llama-mesh|mesh/i,           role: 'domain-3d', desc: '3D / mesh / Blender-oriented model. Niche — geometry and scene tasks.' },
  { m: /gemma-?4|gemma4/i,                       role: 'general',   desc: 'Google Gemma 4 — capable general model, good instruction following.' },
  { m: /gemma-?3|gemma3/i,                       role: 'general',   desc: 'Google Gemma 3 — lightweight general model, fast.' },
  { m: /gemma/i,                                role: 'general',   desc: 'Google Gemma — general chat and drafting.' },
  { m: /llama-?3\.1|meta-llama-3\.1/i,          role: 'general',   desc: 'Meta Llama 3.1 8B — reliable general workhorse, widely tuned.' },
  { m: /llama/i,                                role: 'general',   desc: 'Llama-family general model.' },
  { m: /obliterated|abliterated/i,              role: 'general',   desc: 'Uncensored/abliterated variant — fewer refusals; general use.' },
  { m: /embed|nomic/i,                          role: 'embedding', desc: 'Embedding model — vectors for search/RAG, not chat. Not routable for prompts.' },
  // cloud
  { m: /claude-opus/i,                          role: 'reasoning', desc: 'Anthropic Opus — top-tier reasoning and agentic work. Orchestration-grade.' },
  { m: /claude-sonnet/i,                        role: 'general',   desc: 'Anthropic Sonnet — near-Opus quality at lower cost. Great default.' },
  { m: /claude-haiku/i,                         role: 'general',   desc: 'Anthropic Haiku — fast and cheap for simple, high-volume tasks.' },
  { m: /gpt-4|gpt-5/i,                          role: 'general',   desc: 'OpenAI GPT — strong general model.' },
];

export function describeModel(id) {
  for (const r of RULES) if (r.m.test(id)) return { role: r.role, description: r.desc };
  return { role: 'general', description: 'Local model. General-purpose; no curated profile — try it and label it.' };
}

// role -> which kinds of pipeline steps it suits (used by the orchestrator prompt)
export const ROLE_HINTS = {
  coder: 'writing or editing code, implementing specs',
  reasoning: 'multi-step logic, math, planning, verification',
  vision: 'anything involving an image',
  general: 'summarizing, drafting, classification, chat',
  'domain-3d': '3D geometry, meshes, Blender',
  embedding: 'NOT usable for prompts (vectors only)',
};
