import { createServer, type Server } from 'node:http';

import { createHubRequestHandler } from './handler.js';
import type { HubServerOptions, StartedHubServer } from './types.js';

export const DEFAULT_HUB_HOST = '127.0.0.1';
export const DEFAULT_HUB_PORT = 8_787;
export const DEFAULT_HUB_SHUTDOWN_GRACE_MS = 5_000;

const pendingShutdowns = new WeakMap<Server, Promise<void>>();

function parseHost(value: unknown): string {
  const host = value ?? DEFAULT_HUB_HOST;
  if (
    typeof host !== 'string' ||
    host.length === 0 ||
    host.length > 253 ||
    host !== host.trim() ||
    host.includes('\0') ||
    /[\s/\\]/.test(host)
  ) {
    throw new TypeError('hub host must be an explicit hostname or IP address');
  }
  return host;
}

function parsePort(value: unknown): number {
  const port = value ?? DEFAULT_HUB_PORT;
  if (!Number.isSafeInteger(port) || (port as number) < 0 || (port as number) > 65_535) {
    throw new TypeError('hub port must be an integer between 0 and 65535');
  }
  return port as number;
}

function parseShutdownGraceMs(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 60_000) {
    throw new TypeError('hub shutdown grace must be an integer between 0 and 60000 milliseconds');
  }
  return value as number;
}

export function createHubServer(options: HubServerOptions = {}): Server {
  const handler = createHubRequestHandler(options);
  const server = createServer(
    {
      maxHeaderSize: 16 * 1_024,
      rejectNonStandardBodyWrites: true,
      requireHostHeader: true,
    },
    (request, response) => {
      void handler(request, response);
    },
  );
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function startHubServer(options: HubServerOptions = {}): Promise<StartedHubServer> {
  const host = parseHost(options.host);
  const port = parsePort(options.port);
  const server = createHubServer(options);

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      server.off('error', handleError);
      resolve();
    };
    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, host);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('hub server did not expose a TCP address');
  }
  const urlHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return { server, url: new URL(`http://${urlHost}:${address.port}/`) };
}

export function stopHubServer(
  server: Server,
  graceMs: number = DEFAULT_HUB_SHUTDOWN_GRACE_MS,
): Promise<void> {
  const existing = pendingShutdowns.get(server);
  if (existing !== undefined) {
    return existing;
  }
  const boundedGraceMs = parseShutdownGraceMs(graceMs);

  const shutdown = new Promise<void>((resolve, reject) => {
    let settled = false;
    const forceTimer = setTimeout(() => {
      server.closeAllConnections();
    }, boundedGraceMs);
    forceTimer.unref();

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceTimer);
      if (
        error !== undefined &&
        (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
      ) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      server.close(finish);
      server.closeIdleConnections();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('hub server shutdown failed'));
    }
  });
  pendingShutdowns.set(server, shutdown);
  void shutdown.then(
    () => pendingShutdowns.delete(server),
    () => pendingShutdowns.delete(server),
  );
  return shutdown;
}
