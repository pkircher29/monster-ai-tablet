import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanTools, onPath } from '../lib/scan.mjs';
import { TOOLS } from '../lib/registry.mjs';

describe('AI-Spy Scanner Suite', () => {
  it('should detect valid CLI binaries with onPath', () => {
    const nodePath = onPath('node');
    assert.ok(nodePath, 'node CLI should be found on PATH');
    assert.equal(typeof nodePath, 'string');
  });

  it('should return null for non-existent CLI binaries', () => {
    const fakePath = onPath('non_existent_ai_binary_12345');
    assert.equal(fakePath, null);
  });

  it('should scan host machine and return structured tool registry', () => {
    const result = scanTools();
    assert.ok(result);
    assert.ok(Array.isArray(result.tools));
    assert.ok(Array.isArray(result.dormant));
    
    result.tools.forEach(tool => {
      assert.ok(tool.id);
      assert.ok(tool.name);
      assert.equal(typeof tool.installed, 'boolean');
      assert.equal(typeof tool.dataMB, 'number');
    });
  });

  it('should have well-formed tool definitions in registry', () => {
    assert.ok(TOOLS.length > 10);
    TOOLS.forEach(t => {
      assert.ok(t.id);
      assert.ok(t.name);
      assert.ok(t.category);
    });
  });
});
