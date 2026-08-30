import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_AI_SPY_PORT = 8_792;
const STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export interface AiSpyBridge {
  readonly origin: URL;
  readonly internalToken: string;
  readonly process: ChildProcess;
  stop(): Promise<void>;
}

export interface AiSpyBridgeOptions {
  readonly repositoryRoot?: string;
  readonly port?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

function boundedPort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError('AI-Spy bridge port is invalid');
  }
  return value;
}

async function waitForHealth(origin: URL, internalToken: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('AI-Spy child exited during startup');
    try {
      const response = await fetch(new URL('/api/health', origin), {
        headers: { 'x-monster-internal-token': internalToken },
        redirect: 'error',
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // The loop is bounded and the child commonly needs several probes on Windows.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('AI-Spy child did not become healthy');
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export async function startAiSpyBridge(
  options: AiSpyBridgeOptions = {},
): Promise<AiSpyBridge> {
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const vendorDirectory = resolve(repositoryRoot, 'vendor', 'ai-spy');
  const serverPath = resolve(vendorDirectory, 'server.mjs');
  await access(serverPath);
  const port = boundedPort(options.port ?? DEFAULT_AI_SPY_PORT);
  const origin = new URL(`http://127.0.0.1:${port}/`);
  const internalToken = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [serverPath], {
    cwd: vendorDirectory,
    env: {
      ...(options.environment ?? process.env),
      PORT: String(port),
      AISPY_BIND_HOST: '127.0.0.1',
      AISPY_ENABLE_MDNS: '0',
      AISPY_INTERNAL_TOKEN: internalToken,
    },
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForHealth(origin, internalToken, child);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  return {
    origin,
    internalToken,
    process: child,
    stop: () => stopChild(child),
  };
}
