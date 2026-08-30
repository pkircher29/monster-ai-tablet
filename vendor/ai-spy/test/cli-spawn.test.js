import assert from 'node:assert/strict';
import test from 'node:test';

import { spawnCliSync } from '../lib/cli-spawn.mjs';

test('CLI launcher resolves a fixed executable without enabling a shell', () => {
  const result = spawnCliSync('node', ['--version'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^v\d+/);
  assert.throws(() => spawnCliSync('node & whoami', []), /invalid CLI invocation/);
  assert.throws(() => spawnCliSync('node', ['ok', 1]), /invalid CLI invocation/);
});
