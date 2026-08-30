import type { ReconToolCategory } from '../http/types.js';

export interface ReconToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly profileDirectory: string | null;
  readonly command: string | null;
  readonly category: ReconToolCategory;
  readonly vendor: string;
}

// Adapted from AI-Spy's MIT-licensed registry at revision
// 266c36cfeb3ba44759e91dc91ee3560b3f23c5b1. Pricing and filesystem details are omitted.
export const RECON_TOOL_CATALOG: readonly ReconToolDefinition[] = Object.freeze([
  {
    id: 'claude-code',
    name: 'Claude Code',
    profileDirectory: '.claude',
    command: 'claude',
    category: 'HARNESS',
    vendor: 'Anthropic',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    profileDirectory: '.codex',
    command: 'codex',
    category: 'HARNESS',
    vendor: 'OpenAI',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    profileDirectory: '.gemini',
    command: 'gemini',
    category: 'HARNESS',
    vendor: 'Google',
  },
  {
    id: 'antigravity',
    name: 'Antigravity IDE',
    profileDirectory: '.antigravity',
    command: null,
    category: 'IDE',
    vendor: 'Google',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    profileDirectory: '.copilot',
    command: 'copilot',
    category: 'HARNESS',
    vendor: 'GitHub',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    profileDirectory: null,
    command: 'opencode',
    category: 'HARNESS',
    vendor: 'SST',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    profileDirectory: '.ollama',
    command: 'ollama',
    category: 'LOCAL_MODEL',
    vendor: 'Ollama',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    profileDirectory: '.lmstudio',
    command: null,
    category: 'LOCAL_MODEL',
    vendor: 'LM Studio',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    profileDirectory: '.hermes',
    command: null,
    category: 'ASSISTANT',
    vendor: 'Nous',
  },
  {
    id: 'continue',
    name: 'Continue',
    profileDirectory: '.continue',
    command: null,
    category: 'IDE',
    vendor: 'Continue',
  },
  {
    id: 'aider',
    name: 'Aider Desk',
    profileDirectory: '.aider-desk',
    command: 'aider',
    category: 'HARNESS',
    vendor: 'Aider',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl CLI',
    profileDirectory: '.firecrawl',
    command: 'firecrawl',
    category: 'INFRASTRUCTURE',
    vendor: 'Firecrawl',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    profileDirectory: '.openclaw',
    command: null,
    category: 'HARNESS',
    vendor: 'Community',
  },
  {
    id: 'grease',
    name: 'Grease',
    profileDirectory: '.grease',
    command: null,
    category: 'INFRASTRUCTURE',
    vendor: 'Unknown',
  },
]);
