import { scanTools } from './scan.mjs';
import { analyzeClaudeUsage } from './claude-usage.mjs';
import { analyzeCodex, analyzeOllama, analyzeLMStudio, analyzeGemini } from './other-usage.mjs';
import { loadSubscriptions } from './report.mjs';

export function buildSnapshot() {
  const scan = scanTools();
  const claude = analyzeClaudeUsage();
  const codex = analyzeCodex();
  const ollama = analyzeOllama();
  const lmstudio = analyzeLMStudio();
  const gemini = analyzeGemini();
  const ollamaGB = ollama ? +ollama.models.reduce((a, m) => {
    const v = parseFloat(m.size); return a + (m.size?.includes('GB') ? v : v / 1024);
  }, 0).toFixed(0) : 0;
  return {
    generatedAt: new Date().toISOString(),
    scan, claude, codex, ollama, ollamaGB, lmstudio, gemini,
    subscriptions: loadSubscriptions(),
  };
}
