import assert from 'node:assert/strict';
import { request } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';

import { startAiSpyBridge } from '../dist/index.js';

function get(
  origin: URL,
  token?: string,
  path = '/api/health',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(path, origin),
      { headers: token === undefined ? {} : { 'x-monster-internal-token': token } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('starts AI-Spy on loopback and requires the unexposed internal token', async () => {
  const bridge = await startAiSpyBridge({
    repositoryRoot: resolve(process.cwd(), '..', '..'),
    port: 18_792,
  });
  try {
    assert.equal(bridge.origin.hostname, '127.0.0.1');
    const denied = await get(bridge.origin);
    assert.equal(denied.status, 403);
    assert.doesNotMatch(denied.body, /internalToken|[a-f0-9]{64}/);
    const allowed = await get(bridge.origin, bridge.internalToken);
    assert.equal(allowed.status, 200);
    const runs = await get(bridge.origin, bridge.internalToken, '/api/orchestrate/runs');
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray((JSON.parse(runs.body) as { readonly runs?: unknown }).runs));
  } finally {
    await bridge.stop();
  }
});
