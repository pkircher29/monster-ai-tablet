import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

import { ContractValidationError } from '@monster-agent-hub/contracts';

import { createDelegationPreview } from '../delegation-preview.js';
import { DelegationPreviewInputError } from '../input.js';
import { DEFAULT_HUB_STATIC_DIRECTORY } from './paths.js';
import { createServerOwnedAgentRegistry } from './registry.js';
import { createDefaultAgentStatusProvider } from './status.js';
import type { HubRequestHandlerOptions, ServerOwnedAgentRegistry } from './types.js';

export const DEFAULT_HUB_BUDGET_CEILING_MICRODOLLARS = 400_000;
export const MAX_HUB_REQUEST_BODY_BYTES = 8 * 1_024;
export const MAX_HUB_STATIC_FILE_BYTES = 16 * 1_024 * 1_024;

const DEFAULT_REQUESTED_BY = 'local.operator';
const DEFAULT_WORKSPACE = 'monster-agent-hub';
const DEFAULT_PLAN_REVISION = 1;
const DEFAULT_PLAN_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_TOKEN_CEILING = 40_000;
const DEFAULT_DURATION_CEILING_MS = 400_000;
const MAX_REQUEST_TARGET_LENGTH = 2_048;

const BASE_SECURITY_HEADERS: Readonly<OutgoingHttpHeaders> = Object.freeze({
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

interface PreviewRouteInput {
  readonly objective: string;
  readonly workspace: typeof DEFAULT_WORKSPACE;
  readonly budgetCapMicrodollars: number;
}

interface StaticFile {
  readonly path: string;
  readonly size: number;
}

class StaticPathViolationError extends Error {}

function writeResponse(
  response: ServerResponse,
  statusCode: number,
  headers: OutgoingHttpHeaders,
  body: Buffer,
  omitBody = false,
): void {
  response.writeHead(statusCode, {
    ...BASE_SECURITY_HEADERS,
    ...headers,
    'content-length': body.byteLength,
  });
  response.end(omitBody ? undefined : body);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  extraHeaders: OutgoingHttpHeaders = {},
  omitBody = false,
): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  writeResponse(
    response,
    statusCode,
    {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body,
    omitBody,
  );
}

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

function sendNotFound(response: ServerResponse, omitBody = false): void {
  sendJson(
    response,
    404,
    errorBody('NOT_FOUND', 'The requested local resource was not found.'),
    {},
    omitBody,
  );
}

function parseRequestPath(request: IncomingMessage): string {
  const target = request.url;
  if (
    target === undefined ||
    target.length === 0 ||
    target.length > MAX_REQUEST_TARGET_LENGTH ||
    !target.startsWith('/') ||
    target.startsWith('//')
  ) {
    throw new StaticPathViolationError();
  }
  const rawPath = target.split('?', 1)[0]!;
  if (/%(?:2f|5c)/i.test(rawPath)) {
    throw new StaticPathViolationError();
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new StaticPathViolationError();
  }
  if (decodedPath.includes('\\') || decodedPath.includes('\0')) {
    throw new StaticPathViolationError();
  }
  const segments = decodedPath.split('/').filter((segment) => segment.length > 0);
  if (
    segments.some(
      (segment) =>
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        /[:*?"<>|]/.test(segment) ||
        [...segment].some((character) => {
          const codePoint = character.codePointAt(0)!;
          return codePoint <= 0x1f || codePoint === 0x7f;
        }),
    )
  ) {
    throw new StaticPathViolationError();
  }
  return decodedPath;
}

function sameOriginRequest(request: IncomingMessage): boolean {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return false;
  }
  const originHeader = request.headers.origin;
  if (originHeader === undefined) {
    return true;
  }
  if (Array.isArray(originHeader) || request.headers.host === undefined) {
    return false;
  }

  try {
    const origin = new URL(originHeader);
    return (
      (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      origin.username === '' &&
      origin.password === '' &&
      origin.pathname === '/' &&
      origin.search === '' &&
      origin.hash === '' &&
      origin.host.toLowerCase() === request.headers.host.toLowerCase()
    );
  } catch {
    return false;
  }
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

function isJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers['content-type'];
  return (
    typeof contentType === 'string' &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  );
}

function hasSupportedContentEncoding(request: IncomingMessage): boolean {
  const encoding = request.headers['content-encoding'];
  return encoding === undefined || encoding === 'identity';
}

async function readBoundedBody(
  request: IncomingMessage,
): Promise<{ readonly kind: 'OK'; readonly body: Buffer } | { readonly kind: 'TOO_LARGE' }> {
  const contentLength = request.headers['content-length'];
  if (typeof contentLength === 'string') {
    if (!/^\d+$/.test(contentLength)) {
      throw new SyntaxError('invalid content length');
    }
    if (Number(contentLength) > MAX_HUB_REQUEST_BODY_BYTES) {
      request.resume();
      return { kind: 'TOO_LARGE' };
    }
  }

  const chunks: Buffer[] = [];
  let bytesRead = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytesRead += buffer.byteLength;
    if (bytesRead > MAX_HUB_REQUEST_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  return tooLarge ? { kind: 'TOO_LARGE' } : { kind: 'OK', body: Buffer.concat(chunks, bytesRead) };
}

function parsePreviewRouteInput(value: unknown): PreviewRouteInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('invalid preview request');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('invalid preview request');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (
    keys.length !== 3 ||
    !keys.includes('objective') ||
    !keys.includes('workspace') ||
    !keys.includes('budgetCapMicrodollars') ||
    typeof record.objective !== 'string' ||
    record.workspace !== DEFAULT_WORKSPACE ||
    !Number.isSafeInteger(record.budgetCapMicrodollars) ||
    (record.budgetCapMicrodollars as number) < 0 ||
    (record.budgetCapMicrodollars as number) > DEFAULT_HUB_BUDGET_CEILING_MICRODOLLARS
  ) {
    throw new TypeError('invalid preview request');
  }
  return {
    objective: record.objective,
    workspace: DEFAULT_WORKSPACE,
    budgetCapMicrodollars: record.budgetCapMicrodollars as number,
  };
}

async function handlePreview(
  request: IncomingMessage,
  response: ServerResponse,
  clock: () => Date,
  registry: ServerOwnedAgentRegistry,
): Promise<void> {
  if (!isJsonContentType(request) || !hasSupportedContentEncoding(request)) {
    sendJson(
      response,
      415,
      errorBody('UNSUPPORTED_MEDIA_TYPE', 'Only uncompressed UTF-8 JSON is accepted.'),
    );
    request.resume();
    return;
  }

  let bodyResult: Awaited<ReturnType<typeof readBoundedBody>>;
  try {
    bodyResult = await readBoundedBody(request);
  } catch {
    sendJson(response, 400, errorBody('INVALID_JSON', 'The request body must be valid JSON.'));
    return;
  }
  if (bodyResult.kind === 'TOO_LARGE') {
    sendJson(
      response,
      413,
      errorBody('REQUEST_BODY_TOO_LARGE', 'The request body exceeds the local limit.'),
    );
    return;
  }

  let parsedBody: unknown;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bodyResult.body);
    parsedBody = JSON.parse(decoded) as unknown;
  } catch {
    sendJson(response, 400, errorBody('INVALID_JSON', 'The request body must be valid JSON.'));
    return;
  }

  let routeInput: PreviewRouteInput;
  try {
    routeInput = parsePreviewRouteInput(parsedBody);
  } catch {
    sendJson(
      response,
      422,
      errorBody('INVALID_PREVIEW_REQUEST', 'Expected an authorized local preview request.'),
    );
    return;
  }

  try {
    const now = clock();
    const preview = createDelegationPreview(
      {
        objective: routeInput.objective,
        requestedBy: DEFAULT_REQUESTED_BY,
        previewedAt: now.toISOString(),
        planRevision: DEFAULT_PLAN_REVISION,
        planTtlMs: DEFAULT_PLAN_TTL_MS,
        maxConcurrency: DEFAULT_MAX_CONCURRENCY,
        budget: {
          maxCostMicrodollars: routeInput.budgetCapMicrodollars,
          maxTokens: DEFAULT_TOKEN_CEILING,
          maxDurationMs: DEFAULT_DURATION_CEILING_MS,
        },
      },
      registry.delegationRegistry,
    );
    sendJson(response, 200, preview);
  } catch (error) {
    if (error instanceof DelegationPreviewInputError || error instanceof ContractValidationError) {
      sendJson(
        response,
        422,
        errorBody('PREVIEW_REJECTED', 'The objective is outside the preview-only safety boundary.'),
      );
      return;
    }
    sendJson(
      response,
      500,
      errorBody('INTERNAL_ERROR', 'The local hub could not complete the request safely.'),
    );
  }
}

function isContained(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

async function findStaticFile(
  rootDirectory: string,
  decodedPath: string,
): Promise<StaticFile | null> {
  let root: string;
  try {
    root = await realpath(rootDirectory);
  } catch {
    return null;
  }
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const resolved = resolve(root, `.${requestedPath}`);
  if (!isContained(root, resolved)) {
    throw new StaticPathViolationError();
  }

  let canonical: string;
  try {
    canonical = await realpath(resolved);
  } catch {
    return null;
  }
  if (!isContained(root, canonical)) {
    throw new StaticPathViolationError();
  }
  const metadata = await stat(canonical);
  return metadata.isFile() ? { path: canonical, size: metadata.size } : null;
}

function isSpaRoute(decodedPath: string): boolean {
  if (decodedPath === '/' || decodedPath.endsWith('/')) {
    return false;
  }
  const firstSegment = decodedPath.split('/').filter(Boolean)[0];
  return firstSegment !== 'assets' && firstSegment !== 'icons' && extname(decodedPath) === '';
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  staticDirectory: string,
  decodedPath: string,
): Promise<void> {
  let file = await findStaticFile(staticDirectory, decodedPath);
  if (file === null && isSpaRoute(decodedPath)) {
    file = await findStaticFile(staticDirectory, '/index.html');
  }
  if (file === null) {
    sendNotFound(response, request.method === 'HEAD');
    return;
  }
  if (file.size > MAX_HUB_STATIC_FILE_BYTES) {
    sendJson(
      response,
      413,
      errorBody(
        'STATIC_RESOURCE_TOO_LARGE',
        'The requested static resource exceeds the local serving limit.',
      ),
      {},
      request.method === 'HEAD',
    );
    return;
  }

  const isHead = request.method === 'HEAD';
  const body = isHead ? Buffer.alloc(0) : await readFile(file.path);
  const isHtml = extname(file.path).toLowerCase() === '.html';
  response.writeHead(200, {
    ...BASE_SECURITY_HEADERS,
    'cache-control': isHtml ? 'no-cache' : 'public, max-age=3600',
    'content-length': file.size,
    'content-type': contentTypeFor(file.path),
  });
  response.end(isHead ? undefined : body);
}

export function createHubRequestHandler(
  options: HubRequestHandlerOptions = {},
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const staticDirectory = options.staticDirectory ?? DEFAULT_HUB_STATIC_DIRECTORY;
  const clock = options.clock ?? (() => new Date());
  const registry = options.agentRegistry ?? createServerOwnedAgentRegistry();
  const agentStatusProvider =
    options.agentStatusProvider ?? createDefaultAgentStatusProvider(clock);

  return async (request, response) => {
    try {
      const path = parseRequestPath(request);
      if (isApiPath(path) && !sameOriginRequest(request)) {
        sendJson(
          response,
          403,
          errorBody(
            'CROSS_SITE_REQUEST_REJECTED',
            'Cross-site local API requests are not accepted.',
          ),
        );
        request.resume();
        return;
      }

      if (path === '/api/health') {
        if (request.method !== 'GET') {
          sendJson(
            response,
            405,
            errorBody('METHOD_NOT_ALLOWED', 'This local route does not accept that method.'),
            { allow: 'GET' },
          );
          request.resume();
          return;
        }
        sendJson(response, 200, {
          status: 'ok',
          service: 'monster-agent-hub',
          mode: 'PREVIEW_ONLY',
          schemaVersion: 1,
        });
        return;
      }

      if (path === '/api/agents/status') {
        if (request.method !== 'GET') {
          sendJson(
            response,
            405,
            errorBody('METHOD_NOT_ALLOWED', 'This local route does not accept that method.'),
            { allow: 'GET' },
          );
          request.resume();
          return;
        }
        sendJson(response, 200, await agentStatusProvider());
        return;
      }

      if (path === '/api/delegation/preview') {
        if (request.method !== 'POST') {
          sendJson(
            response,
            405,
            errorBody('METHOD_NOT_ALLOWED', 'This local route does not accept that method.'),
            { allow: 'POST' },
          );
          request.resume();
          return;
        }
        await handlePreview(request, response, clock, registry);
        return;
      }

      if (isApiPath(path)) {
        sendNotFound(response, request.method === 'HEAD');
        request.resume();
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(
          response,
          405,
          errorBody('METHOD_NOT_ALLOWED', 'Static resources accept GET or HEAD only.'),
          { allow: 'GET, HEAD' },
          request.method === 'HEAD',
        );
        request.resume();
        return;
      }
      await serveStatic(request, response, staticDirectory, path);
    } catch (error) {
      if (error instanceof StaticPathViolationError) {
        sendJson(response, 400, errorBody('INVALID_PATH', 'The requested local path is invalid.'));
        return;
      }
      if (!response.headersSent) {
        sendJson(
          response,
          500,
          errorBody('INTERNAL_ERROR', 'The local hub could not complete the request safely.'),
        );
      } else {
        response.destroy();
      }
    }
  };
}
