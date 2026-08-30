import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createAiSpyProxy, createHubAuth, startHubServer, stopHubServer } from '../dist/index.js';

interface TestResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Buffer;
}

function send(
  base: URL,
  path: string,
  options: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: base.hostname,
        port: base.port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

function json(response: TestResponse): Record<string, unknown> {
  return JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
}

test('AI-Spy proxy authenticates data and binds one-shot approvals without leaking request bodies', async () => {
  const internalToken = 'a'.repeat(64);
  const upstreamRequests: Array<{ method: string; path: string; body: string }> = [];
  const upstream = createServer((request, response) => {
    assert.equal(request.headers['x-monster-internal-token'], internalToken);
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      upstreamRequests.push({ method: request.method ?? '', path: request.url ?? '', body });
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>AI-Spy isolated console</title>');
      } else {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ ok: true, path: request.url }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const address = upstream.address();
  assert.ok(address !== null && typeof address !== 'string');
  const temporary = await mkdtemp(join(tmpdir(), 'monster-ai-spy-proxy-'));
  const auditFile = join(temporary, 'audit.jsonl');
  const auth = createHubAuth({ password: 'test-only-operator-password' });
  const proxy = createAiSpyProxy({
    origin: new URL(`http://127.0.0.1:${address.port}/`),
    internalToken,
    auditFile,
  });
  const hub = await startHubServer({ host: '127.0.0.1', port: 0, auth, aiSpyProxy: proxy });

  try {
    const shell = await send(hub.url, '/ai-spy/');
    assert.equal(shell.statusCode, 200);
    assert.match(shell.body.toString('utf8'), /isolated console/);
    assert.match(
      String(shell.headers['content-security-policy']),
      /style-src 'self' 'unsafe-inline'/,
    );
    assert.match(String(shell.headers['content-security-policy']), /script-src 'self';/);
    assert.doesNotMatch(
      String(shell.headers['content-security-policy']),
      /script-src[^;]*unsafe-inline/,
    );

    const denied = await send(hub.url, '/api/ai-spy/snapshot');
    assert.equal(denied.statusCode, 401);
    assert.equal(upstreamRequests.length, 1);

    const login = await send(hub.url, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-only-operator-password' }),
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers['set-cookie']?.[0]).split(';', 1)[0]!;

    const snapshot = await send(hub.url, '/api/ai-spy/snapshot?refresh=0', { headers: { cookie } });
    assert.equal(snapshot.statusCode, 200);
    assert.equal(upstreamRequests.at(-1)?.path, '/api/snapshot?refresh=0');

    const sensitiveBody = JSON.stringify({
      objective: 'do not place this objective in audit logs',
    });
    const challenged = await send(hub.url, '/api/ai-spy/orchestrate/jobs', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: sensitiveBody,
    });
    assert.equal(challenged.statusCode, 428);
    const challenge = json(challenged);
    assert.equal(challenge.confirmationPhrase, 'AUTHORIZE AGENT ACTION');

    const wrong = await send(hub.url, '/api/ai-spy/approval', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ approvalId: challenge.approvalId, confirmation: 'wrong' }),
    });
    assert.equal(wrong.statusCode, 403);

    const retryChallenge = json(
      await send(hub.url, '/api/ai-spy/orchestrate/jobs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: sensitiveBody,
      }),
    );
    const approved = await send(hub.url, '/api/ai-spy/approval', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        approvalId: retryChallenge.approvalId,
        confirmation: retryChallenge.confirmationPhrase,
      }),
    });
    assert.equal(approved.statusCode, 200);
    const approvalToken = String(json(approved).approvalToken);

    const forwarded = await send(hub.url, '/api/ai-spy/orchestrate/jobs', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-monster-approval': approvalToken },
      body: sensitiveBody,
    });
    assert.equal(forwarded.statusCode, 200);
    assert.equal(upstreamRequests.at(-1)?.body, sensitiveBody);

    const replay = await send(hub.url, '/api/ai-spy/orchestrate/jobs', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-monster-approval': approvalToken },
      body: sensitiveBody,
    });
    assert.equal(replay.statusCode, 428);

    const audit = await readFile(auditFile, 'utf8');
    assert.doesNotMatch(audit, /do not place this objective/);
    assert.doesNotMatch(audit, new RegExp(internalToken));
    assert.match(audit, /APPROVAL_GRANTED/);
    assert.match(audit, /FORWARDED_200/);
  } finally {
    await stopHubServer(hub.server, 100);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});
