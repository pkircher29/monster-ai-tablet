import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localIPs, localListeners, tcpOpen } from '../lib/network.mjs';

describe('AI-Spy Network Discovery', () => {
  it('should discover local IPv4 interfaces', () => {
    const ips = localIPs();
    assert.ok(ips);
    assert.ok(Array.isArray(ips.all));
  });

  it('should enumerate listening TCP sockets without throwing', () => {
    const listeners = localListeners();
    assert.ok(Array.isArray(listeners));
    listeners.forEach(l => {
      assert.ok(typeof l.port === 'number');
      assert.ok(l.addr);
    });
  });

  it('should probe closed ports gracefully', async () => {
    const open = await tcpOpen('127.0.0.1', 59999, 200);
    assert.equal(open, false);
  });
});
