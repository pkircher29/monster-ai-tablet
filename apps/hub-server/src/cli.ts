import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_HUB_HOST,
  DEFAULT_HUB_PORT,
  startHubServer,
  stopHubServer,
} from './http/server.js';
import { createHubAuth } from './auth.js';
import { startAiSpyBridge } from './ai-spy/bridge.js';
import { createAiSpyProxy } from './ai-spy/proxy.js';
import { loadHubLocalConfiguration } from './configuration.js';

function configuredPort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_HUB_PORT;
  }
  if (!/^\d+$/.test(raw)) {
    throw new TypeError('MONSTER_HUB_PORT must be a decimal TCP port');
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('MONSTER_HUB_PORT must be between 1 and 65535');
  }
  return port;
}

export async function runHubCli(): Promise<void> {
  const host = process.env.MONSTER_HUB_HOST ?? DEFAULT_HUB_HOST;
  const port = configuredPort(process.env.MONSTER_HUB_PORT);
  const configuration = await loadHubLocalConfiguration();
  const auth = createHubAuth({ password: configuration.adminPassword });
  const aiSpy = await startAiSpyBridge();
  let started: Awaited<ReturnType<typeof startHubServer>>;
  try {
    started = await startHubServer({
      host,
      port,
      auth,
      aiSpyProxy: createAiSpyProxy({
        origin: aiSpy.origin,
        internalToken: aiSpy.internalToken,
      }),
    });
  } catch (error) {
    await aiSpy.stop();
    throw error;
  }
  process.stdout.write(`Monster Agent Hub listening on ${started.url.origin}\n`);

  let closing = false;
  const close = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    void Promise.all([stopHubServer(started.server), aiSpy.stop()]).then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.stderr.write('Monster Agent Hub could not shut down cleanly.\n');
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  runHubCli().catch(() => {
    process.stderr.write(
      'Monster Agent Hub failed to start with the supplied local configuration.\n',
    );
    process.exitCode = 1;
  });
}
