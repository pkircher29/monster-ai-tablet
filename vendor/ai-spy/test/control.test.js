import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tcpOpen, waitUp, killPort } from '../lib/control.mjs';

describe('AI-Spy Process & Agent Control', () => {
  it('should handle port probing timeout correctly', async () => {
    const isOpen = await tcpOpen('127.0.0.1', 59998, 200);
    assert.equal(isOpen, false);
  });

  it('should safely return false when killing non-numeric or invalid ports', () => {
    assert.equal(killPort(null), false);
    assert.equal(killPort(0), false);
  });
});
