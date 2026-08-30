import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { costUSD, priceFor, PRICING } from '../lib/pricing.mjs';

describe('AI-Spy Pricing Engine', () => {
  it('should calculate accurate cost for Claude Sonnet', () => {
    const cost = costUSD('claude-sonnet-4-6', {
      input: 1000000,
      output: 1000000,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0
    });
    assert.equal(cost, 18.0);
  });

  it('should return default tier pricing for unknown models', () => {
    const p = priceFor('unknown-custom-model');
    assert.ok(p.in > 0);
    assert.ok(p.out > 0);
  });

  it('should match known model tiers in PRICING catalog', () => {
    assert.ok(PRICING['claude-sonnet-5']);
    assert.equal(PRICING['claude-sonnet-5'].in, 3.0);
  });
});
