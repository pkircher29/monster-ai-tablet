import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';

import type { HubAuthSession } from '../auth.js';

const MAX_PROXY_REQUEST_BYTES = 256 * 1_024;
const MAX_PROXY_RESPONSE_BYTES = 8 * 1_024 * 1_024;
const APPROVAL_CHALLENGE_TTL_MS = 5 * 60_000;
const APPROVAL_TOKEN_TTL_MS = 2 * 60_000;
const DEFAULT_REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export interface AiSpyProxyResult {
  readonly statusCode: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly body: Buffer;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface AiSpyProxyOptions {
  readonly origin: URL;
  readonly internalToken: string;
  readonly auditFile?: string;
  readonly clock?: () => number;
  readonly random?: (size: number) => Buffer;
}

export interface AiSpyProxy {
  handle(
    request: IncomingMessage,
    publicPath: string,
    session: HubAuthSession | null,
  ): Promise<AiSpyProxyResult>;
}

interface ApprovalChallenge {
  readonly id: string;
  readonly sessionId: string;
  readonly fingerprint: string;
  readonly confirmation: string;
  readonly expiresAt: number;
}

interface ApprovalGrant {
  readonly token: string;
  readonly sessionId: string;
  readonly fingerprint: string;
  readonly expiresAt: number;
}

function jsonResult(
  statusCode: number,
  value: unknown,
  extraHeaders?: Readonly<Record<string, string>>,
): AiSpyProxyResult {
  const result: AiSpyProxyResult = {
    statusCode,
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'no-store',
    body: Buffer.from(JSON.stringify(value), 'utf8'),
  };
  return extraHeaders === undefined ? result : { ...result, extraHeaders };
}

function apiError(
  statusCode: number,
  code: string,
  message: string,
  extraHeaders?: Readonly<Record<string, string>>,
): AiSpyProxyResult {
  return jsonResult(statusCode, { error: { code, message } }, extraHeaders);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | null> {
  const declared = request.headers['content-length'];
  if (
    typeof declared === 'string' &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_PROXY_REQUEST_BYTES)
  ) {
    request.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > MAX_PROXY_REQUEST_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

async function readResponseBody(response: Response): Promise<Buffer | null> {
  if (response.body === null) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return Buffer.concat(chunks, size);
      const chunk = Buffer.from(result.value);
      size += chunk.byteLength;
      if (size > MAX_PROXY_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
}

function upstreamTarget(publicPath: string, origin: URL): URL | null {
  const parsed = new URL(publicPath, 'http://monster.invalid');
  let pathname: string;
  if (parsed.pathname === '/ai-spy' || parsed.pathname === '/ai-spy/') pathname = '/';
  else if (parsed.pathname.startsWith('/ai-spy/'))
    pathname = parsed.pathname.slice('/ai-spy'.length);
  else if (parsed.pathname.startsWith('/api/ai-spy/'))
    pathname = `/api/${parsed.pathname.slice('/api/ai-spy/'.length)}`;
  else return null;
  const target = new URL(pathname, origin);
  target.search = parsed.search;
  return target;
}

function isApiPath(path: string): boolean {
  return path === '/api/ai-spy' || path.startsWith('/api/ai-spy/');
}

function isApprovalRoute(path: string): boolean {
  return new URL(path, 'http://monster.invalid').pathname === '/api/ai-spy/approval';
}

function requiresApproval(method: string, path: string): boolean {
  const parsed = new URL(path, 'http://monster.invalid');
  if (method === 'GET')
    return parsed.pathname.endsWith('/network') && parsed.searchParams.get('lan') === '1';
  if (method !== 'POST') return false;
  if (isApprovalRoute(path)) return false;
  return !(
    /^\/api\/ai-spy\/agora\/(?:rooms|rooms\/[^/]+\/message)$/.test(parsed.pathname) ||
    /^\/api\/ai-spy\/agents\/[^/]+\/(?:rename|describe)$/.test(parsed.pathname)
  );
}

function requiredConfirmation(path: string): string {
  return /\/(?:keys|skills|directive)(?:\/|$)|\/model$|[?&]lan=1(?:&|$)/.test(path)
    ? 'AUTHORIZE ADMIN ACTION'
    : 'AUTHORIZE AGENT ACTION';
}

function fingerprint(method: string, path: string, body: Buffer): string {
  return createHash('sha256')
    .update(method)
    .update('\0')
    .update(path)
    .update('\0')
    .update(body)
    .digest('hex');
}

function safeSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

export function createAiSpyProxy(options: AiSpyProxyOptions): AiSpyProxy {
  if (options.origin.protocol !== 'http:' || options.origin.hostname !== '127.0.0.1') {
    throw new TypeError('AI-Spy proxy origin must be loopback HTTP');
  }
  if (!/^[a-f0-9]{64}$/.test(options.internalToken)) {
    throw new TypeError('AI-Spy internal token is invalid');
  }
  const clock = options.clock ?? Date.now;
  const random = options.random ?? randomBytes;
  const auditFile = resolve(
    options.auditFile ?? resolve(DEFAULT_REPOSITORY_ROOT, '.monster-hub', 'audit.jsonl'),
  );
  const challenges = new Map<string, ApprovalChallenge>();
  const grants = new Map<string, ApprovalGrant>();

  const prune = (): void => {
    const now = clock();
    for (const [id, challenge] of challenges) if (challenge.expiresAt <= now) challenges.delete(id);
    for (const [token, grant] of grants) if (grant.expiresAt <= now) grants.delete(token);
  };

  const audit = async (
    session: HubAuthSession,
    method: string,
    path: string,
    decision: string,
  ): Promise<void> => {
    await mkdir(dirname(auditFile), { recursive: true });
    await appendFile(
      auditFile,
      `${JSON.stringify({ timestamp: new Date(clock()).toISOString(), session: safeSessionId(session.id), method, route: new URL(path, 'http://monster.invalid').pathname, decision })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  };

  return {
    async handle(request, publicPath, session) {
      const method = request.method ?? 'GET';
      if (!['GET', 'HEAD', 'POST'].includes(method)) {
        request.resume();
        return apiError(405, 'METHOD_NOT_ALLOWED', 'AI-Spy accepts GET, HEAD, or POST.', {
          allow: 'GET, HEAD, POST',
        });
      }
      const apiRequest = isApiPath(publicPath);
      if (apiRequest && session === null) {
        request.resume();
        return apiError(401, 'AUTHENTICATION_REQUIRED', 'Operator login is required.');
      }
      const body =
        method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readRequestBody(request);
      if (body === null)
        return apiError(413, 'REQUEST_BODY_TOO_LARGE', 'The AI-Spy request body is too large.');
      prune();

      if (isApprovalRoute(publicPath)) {
        if (method !== 'POST' || session === null)
          return apiError(405, 'METHOD_NOT_ALLOWED', 'Approval requires POST.');
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          return apiError(400, 'INVALID_JSON', 'Approval must be valid JSON.');
        }
        const record = parsed as { readonly approvalId?: unknown; readonly confirmation?: unknown };
        if (
          typeof record !== 'object' ||
          record === null ||
          typeof record.approvalId !== 'string' ||
          typeof record.confirmation !== 'string'
        ) {
          return apiError(422, 'INVALID_APPROVAL', 'The approval request is invalid.');
        }
        const challenge = challenges.get(record.approvalId);
        challenges.delete(record.approvalId);
        if (
          challenge === undefined ||
          challenge.sessionId !== session.id ||
          challenge.confirmation !== record.confirmation
        ) {
          await audit(session, method, publicPath, 'APPROVAL_REJECTED');
          return apiError(403, 'APPROVAL_REJECTED', 'The approval was rejected or expired.');
        }
        const token = random(32).toString('hex');
        grants.set(token, {
          token,
          sessionId: session.id,
          fingerprint: challenge.fingerprint,
          expiresAt: clock() + APPROVAL_TOKEN_TTL_MS,
        });
        await audit(session, method, publicPath, 'APPROVAL_GRANTED');
        return jsonResult(200, {
          schemaVersion: 1,
          approvalToken: token,
          expiresInSeconds: APPROVAL_TOKEN_TTL_MS / 1_000,
        });
      }

      if (apiRequest && session !== null && requiresApproval(method, publicPath)) {
        const requestFingerprint = fingerprint(method, publicPath, body);
        const supplied = request.headers['x-monster-approval'];
        const approvalToken = typeof supplied === 'string' ? supplied : '';
        const grant = grants.get(approvalToken);
        if (
          grant === undefined ||
          grant.sessionId !== session.id ||
          grant.fingerprint !== requestFingerprint
        ) {
          if (grant !== undefined) grants.delete(approvalToken);
          const id = random(16).toString('hex');
          const confirmation = requiredConfirmation(publicPath);
          challenges.set(id, {
            id,
            sessionId: session.id,
            fingerprint: requestFingerprint,
            confirmation,
            expiresAt: clock() + APPROVAL_CHALLENGE_TTL_MS,
          });
          await audit(session, method, publicPath, 'APPROVAL_REQUIRED');
          return jsonResult(428, {
            error: {
              code: 'APPROVAL_REQUIRED',
              message: 'Confirm this one AI-Spy action before it runs.',
            },
            approvalId: id,
            confirmationPhrase: confirmation,
          });
        }
        grants.delete(approvalToken);
      }

      const target = upstreamTarget(publicPath, options.origin);
      if (target === null) return apiError(404, 'NOT_FOUND', 'The AI-Spy resource was not found.');
      try {
        const requestInit: RequestInit = {
          method,
          headers: {
            'x-monster-internal-token': options.internalToken,
            ...(body.byteLength > 0
              ? {
                  'content-type':
                    typeof request.headers['content-type'] === 'string'
                      ? request.headers['content-type']
                      : 'application/json',
                }
              : {}),
          },
          redirect: 'error',
          signal: AbortSignal.timeout(180_000),
        };
        if (body.byteLength > 0) requestInit.body = new Uint8Array(body);
        const upstream = await fetch(target, requestInit);
        const declaredLength = upstream.headers.get('content-length');
        if (declaredLength !== null && Number(declaredLength) > MAX_PROXY_RESPONSE_BYTES) {
          return apiError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', 'AI-Spy returned too much data.');
        }
        const responseBody = await readResponseBody(upstream);
        if (responseBody === null)
          return apiError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', 'AI-Spy returned too much data.');
        if (apiRequest && session !== null)
          await audit(session, method, publicPath, `FORWARDED_${upstream.status}`);
        return {
          statusCode: upstream.status,
          contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
          cacheControl: apiRequest
            ? 'no-store'
            : (upstream.headers.get('cache-control') ?? 'no-cache'),
          body: responseBody,
        };
      } catch {
        if (apiRequest && session !== null)
          await audit(session, method, publicPath, 'UPSTREAM_FAILED');
        return apiError(502, 'AI_SPY_UNAVAILABLE', 'The isolated AI-Spy service is unavailable.');
      }
    },
  };
}
