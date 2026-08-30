import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanAllSkills, transmuteSkill, saveSkill, deploySkillToHarness, scanAllMcpServers } from '../lib/skill-hub.mjs';

describe('Universal Cross-Agent Skill Hub', () => {
  it('should scan and aggregate skills across all available harnesses', () => {
    const skills = scanAllSkills();
    assert.ok(Array.isArray(skills));
    // If skills exist on machine, verify structure
    if (skills.length > 0) {
      const s = skills[0];
      assert.ok(s.id);
      assert.ok(s.name);
      assert.ok(s.sourceHarness);
      assert.ok(s.rawContent);
    }
  });

  it('should transmute skills accurately across Claude, Hermes, Gemini, and OpenCode formats', () => {
    const rawClaudeSkill = `---
name: code-reviewer
description: Automated code review skill
---
# Instructions
Review the diff carefully for performance and security vulnerabilities.`;

    // 1. Transmute to Hermes format
    const hermesFormat = transmuteSkill(rawClaudeSkill, 'hermes', { name: 'code-reviewer' });
    assert.ok(hermesFormat.includes('Hermes Skill: code-reviewer'));
    assert.ok(hermesFormat.includes('Review the diff carefully'));

    // 2. Transmute to OpenCode format
    const openCodeFormat = transmuteSkill(rawClaudeSkill, 'opencode');
    assert.ok(openCodeFormat.includes('code-reviewer'));
    assert.ok(openCodeFormat.includes('Review the diff carefully'));

    // 3. Transmute to Gemini format
    const geminiFormat = transmuteSkill(rawClaudeSkill, 'gemini');
    assert.ok(geminiFormat.includes('name: code-reviewer'));
  });

  it('should save custom skills into the central library vault', () => {
    const res = saveSkill({
      key: 'test-shared-skill',
      name: 'Test Shared Skill',
      description: 'A test skill for cross-agent collaboration',
      content: '# Shared Instructions\nExecute collaborative reasoning.',
      targetHarness: 'library'
    });

    assert.equal(res.ok, true);
    assert.equal(res.key, 'test-shared-skill');
  });

  it('should discover configured MCP servers across tools', () => {
    const servers = scanAllMcpServers();
    assert.ok(Array.isArray(servers));
  });
});
