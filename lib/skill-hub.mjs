import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const DATA_DIR = join(HOME, '.ai-spy', 'skills');

const HARNESS_SKILL_PATHS = {
  hermes: join(HOME, '.hermes', 'skills'),
  claude: join(HOME, '.claude', 'skills'),
  gemini: join(HOME, '.gemini', 'antigravity-cli', 'builtin', 'skills'),
  opencode: join(HOME, '.opencode', 'skills'),
  library: DATA_DIR
};

function ensureDir(p) {
  if (!existsSync(p)) {
    try { mkdirSync(p, { recursive: true }); } catch {}
  }
}

function parseSkillContent(raw) {
  let name = 'unnamed-skill';
  let description = '';
  let body = raw;

  // Check YAML Frontmatter
  const yamlMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    body = yamlMatch[2].trim();

    const nameMatch = yaml.match(/^name:\s*([^\r\n]+)/m);
    if (nameMatch) name = nameMatch[1].replace(/^["']|["']$/g, '').trim();

    const descMatch = yaml.match(/^description:\s*([^\r\n]+)/m);
    if (descMatch) description = descMatch[1].replace(/^["']|["']$/g, '').trim();
  } else {
    // Markdown header extraction
    const h1Match = raw.match(/^#\s*([^\r\n]+)/m);
    if (h1Match) name = h1Match[1].trim();

    const descMatch = raw.match(/(?:description|purpose|summary):\s*([^\r\n]+)/i);
    if (descMatch) description = descMatch[1].trim();
  }

  return { name, description, body, raw };
}

export function scanAllSkills() {
  ensureDir(DATA_DIR);
  const catalog = [];
  const seen = new Set();

  for (const [harness, basePath] of Object.entries(HARNESS_SKILL_PATHS)) {
    if (!existsSync(basePath)) continue;
    let entries = [];
    try {
      entries = readdirSync(basePath, { withFileTypes: true });
    } catch { continue; }

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const fullDir = join(basePath, e.name);
      if (!statSync(fullDir).isDirectory()) continue;

      let skillMdPath = join(fullDir, 'SKILL.md');
      if (!existsSync(skillMdPath)) {
        skillMdPath = join(fullDir, 'skill.md');
      }

      if (existsSync(skillMdPath)) {
        try {
          const raw = readFileSync(skillMdPath, 'utf8');
          const parsed = parseSkillContent(raw);
          const skillId = `${harness}:${e.name}`;
          
          catalog.push({
            id: skillId,
            key: e.name,
            name: parsed.name !== 'unnamed-skill' ? parsed.name : e.name,
            sourceHarness: harness,
            description: parsed.description || `Skill for ${harness}`,
            rawContent: raw,
            body: parsed.body,
            dirPath: fullDir,
            filePath: skillMdPath,
            updatedAt: new Date(statSync(skillMdPath).mtimeMs).toISOString()
          });
          seen.add(e.name);
        } catch {}
      }
    }
  }

  return catalog;
}

export function transmuteSkill(rawContent, targetHarness, overrides = {}) {
  const parsed = parseSkillContent(rawContent);
  const name = overrides.name || parsed.name;
  const description = overrides.description || parsed.description;
  const body = overrides.body || parsed.body;

  if (targetHarness === 'claude' || targetHarness === 'gemini' || targetHarness === 'library') {
    return `---
name: ${name}
description: ${description}
---

# ${name}

${body}
`;
  } else if (targetHarness === 'hermes') {
    return `---
name: ${name}
description: ${description}
---

# Hermes Skill: ${name}

## Instructions
${body}
`;
  } else if (targetHarness === 'opencode') {
    return `# ${name}
<!-- description: ${description} -->

${body}
`;
  }

  return rawContent;
}

export function saveSkill({ key, name, description, content, targetHarness = 'library' }) {
  const safeKey = (key || name || 'custom-skill').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const basePath = HARNESS_SKILL_PATHS[targetHarness] || DATA_DIR;
  ensureDir(basePath);

  const targetDir = join(basePath, safeKey);
  ensureDir(targetDir);

  const finalContent = transmuteSkill(content, targetHarness, { name, description });
  const targetFile = join(targetDir, 'SKILL.md');

  writeFileSync(targetFile, finalContent, 'utf8');

  return {
    ok: true,
    skillId: `${targetHarness}:${safeKey}`,
    key: safeKey,
    harness: targetHarness,
    path: targetFile
  };
}

export function deploySkillToHarness({ skillKey, fromHarness, toHarness, modifications = {} }) {
  if (!HARNESS_SKILL_PATHS[toHarness]) {
    return { ok: false, error: `Unknown target harness: ${toHarness}` };
  }

  const allSkills = scanAllSkills();
  const source = allSkills.find(s => s.key === skillKey && (fromHarness ? s.sourceHarness === fromHarness : true));

  if (!source) {
    return { ok: false, error: `Skill "${skillKey}" not found in source harness.` };
  }

  const destBase = HARNESS_SKILL_PATHS[toHarness];
  ensureDir(destBase);

  const destDir = join(destBase, skillKey);
  ensureDir(destDir);

  const transmuted = transmuteSkill(source.rawContent, toHarness, modifications);
  const destFile = join(destDir, 'SKILL.md');
  writeFileSync(destFile, transmuted, 'utf8');

  // Copy any accessory files / scripts
  try {
    const files = readdirSync(source.dirPath, { withFileTypes: true });
    for (const f of files) {
      if (f.isFile() && !f.name.toLowerCase().endsWith('.md')) {
        copyFileSync(join(source.dirPath, f.name), join(destDir, f.name));
      }
    }
  } catch {}

  return {
    ok: true,
    deployedTo: toHarness,
    skillKey,
    destPath: destFile,
    transmuted: true
  };
}

/* ---------- Cross-Harness MCP Server Hub ---------- */

export function scanAllMcpServers() {
  const servers = [];

  // Claude JSON
  const claudeJsonPath = join(HOME, '.claude.json');
  if (existsSync(claudeJsonPath)) {
    try {
      const cj = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
      for (const [name, cfg] of Object.entries(cj.mcpServers || {})) {
        servers.push({ name, harness: 'claude', command: cfg.command, args: cfg.args, env: cfg.env });
      }
    } catch {}
  }

  // Gemini / Antigravity settings
  const geminiSettings = join(HOME, '.gemini', 'settings.json');
  if (existsSync(geminiSettings)) {
    try {
      const gj = JSON.parse(readFileSync(geminiSettings, 'utf8'));
      for (const [name, cfg] of Object.entries(gj.mcpServers || {})) {
        servers.push({ name, harness: 'gemini', command: cfg.command, args: cfg.args, env: cfg.env });
      }
    } catch {}
  }

  // Codex TOML
  const codexToml = join(HOME, '.codex', 'config.toml');
  if (existsSync(codexToml)) {
    try {
      const txt = readFileSync(codexToml, 'utf8');
      const matches = [...txt.matchAll(/\[mcp_servers\.([A-Za-z0-9_-]+)\]([\s\S]*?)(?=\n\[|$)/g)];
      for (const m of matches) {
        const name = m[1];
        const block = m[2];
        const cmdMatch = block.match(/command\s*=\s*"([^"]+)"/);
        servers.push({ name, harness: 'codex', command: cmdMatch ? cmdMatch[1] : 'unknown', raw: block.trim() });
      }
    } catch {}
  }

  return servers;
}
