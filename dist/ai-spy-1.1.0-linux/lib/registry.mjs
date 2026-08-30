// Known AI tool/harness registry. Detection is by home-dir footprint and/or CLI on PATH.
// category: harness = coding agent/CLI, ide = AI IDE/editor, local = local model runtime,
//           assistant = general assistant, infra = supporting tool
export const TOOLS = [
  { id: 'claude-code',   name: 'Claude Code',        dir: '.claude',       cli: 'claude',   category: 'harness', vendor: 'Anthropic', pricing: 'subscription (Pro/Max) or API' },
  { id: 'codex',         name: 'OpenAI Codex CLI',   dir: '.codex',        cli: 'codex',    category: 'harness', vendor: 'OpenAI',    pricing: 'ChatGPT plan or API' },
  { id: 'gemini-cli',    name: 'Gemini CLI',         dir: '.gemini',       cli: 'gemini',   category: 'harness', vendor: 'Google',    pricing: 'free tier / API' },
  { id: 'antigravity',   name: 'Antigravity IDE',    dir: '.antigravity',  cli: null,       category: 'ide',     vendor: 'Google',    pricing: 'free preview' },
  { id: 'copilot',       name: 'GitHub Copilot CLI', dir: '.copilot',      cli: 'copilot',  category: 'harness', vendor: 'GitHub',    pricing: '$10-39/mo' },
  { id: 'opencode',      name: 'OpenCode',           dir: null,            cli: 'opencode', category: 'harness', vendor: 'SST',       pricing: 'BYO API key' },
  { id: 'ollama',        name: 'Ollama',             dir: '.ollama',       cli: 'ollama',   category: 'local',   vendor: 'Ollama',    pricing: 'free (local compute + disk)' },
  { id: 'lmstudio',      name: 'LM Studio',          dir: '.lmstudio',     cli: null,       category: 'local',   vendor: 'LM Studio', pricing: 'free (local compute + disk)' },
  { id: 'hermes',        name: 'Hermes',             dir: '.hermes',       cli: null,       category: 'assistant', vendor: 'Nous',    pricing: 'unknown' },
  { id: 'continue',      name: 'Continue',           dir: '.continue',     cli: null,       category: 'ide',     vendor: 'Continue',  pricing: 'BYO API key' },
  { id: 'aider',         name: 'Aider Desk',         dir: '.aider-desk',   cli: 'aider',    category: 'harness', vendor: 'Aider',     pricing: 'BYO API key' },
  { id: 'firecrawl',     name: 'Firecrawl CLI',      dir: '.firecrawl',    cli: 'firecrawl',category: 'infra',   vendor: 'Firecrawl', pricing: 'API credits' },
  { id: 'openclaw',      name: 'OpenClaw',           dir: '.openclaw',     cli: null,       category: 'harness', vendor: 'community', pricing: 'BYO API key' },
  { id: 'grease',        name: 'Grease',             dir: '.grease',       cli: null,       category: 'infra',   vendor: 'unknown',   pricing: 'unknown' },
];

// Dot-dirs that indicate an installed-but-likely-unused AI tool (footprint scan catches these generically)
export const EXTRA_AI_DIRS = [
  '.agents', '.augment', '.autohand', '.codebuddy', '.codeium', '.codemaker', '.codestudio',
  '.commandcode', '.factory', '.forge', '.iflow', '.junie', '.kilocode', '.kiro', '.kode',
  '.lingma', '.moxby', '.mux', '.neovate', '.ona', '.openhands', '.pi', '.pochi', '.qoder',
  '.qoder-cn', '.qwen', '.reasonix', '.roo', '.rovodev', '.tabnine', '.terramind', '.trae',
  '.trae-cn', '.vibe', '.zencoder', '.astrbot', '.bob', '.jazz', '.tinycloud', '.codeartsdoer',
  '.mcpjam', '.inferencesh',
];
