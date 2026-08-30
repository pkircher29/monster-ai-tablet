import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hermesInventory, hermesUsage, getHermesGatewayState } from '../lib/hermes.mjs';

describe('Hermes First-Class Integration', () => {
  it('should parse Hermes gateway status gracefully', () => {
    const gw = getHermesGatewayState();
    assert.ok(typeof gw === 'object');
    assert.ok('running' in gw);
    assert.ok('status' in gw);
  });

  it('should scan Hermes inventory and detect skills & profiles', () => {
    const inv = hermesInventory();
    if (inv) {
      assert.equal(inv.installed, true);
      assert.ok(Array.isArray(inv.skills));
      assert.ok(Array.isArray(inv.profiles));
      assert.ok('hasSoul' in inv);
    }
  });

  it('should calculate Hermes usage and state DB footprint', () => {
    const usage = hermesUsage();
    if (usage) {
      assert.equal(usage.harness, 'hermes');
      assert.ok(typeof usage.stateDbMB === 'number');
      assert.ok(typeof usage.sessions === 'number');
    }
  });
});
