import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ReconProvider, ReconToolDetection, ReconToolSummary } from '../http/types.js';
import { RECON_TOOL_CATALOG } from './catalog.js';
import { createDirectCliLocator, type CliLocator } from './locator.js';

export interface ToolReconProviderOptions {
  readonly clock?: () => Date;
  readonly homeDirectory?: string;
  readonly pathExists?: (path: string) => boolean;
  readonly cliLocator?: CliLocator;
}

export function createToolReconProvider(options: ToolReconProviderOptions = {}): ReconProvider {
  const clock = options.clock ?? (() => new Date());
  const homeDirectory = options.homeDirectory ?? homedir();
  const pathExists = options.pathExists ?? existsSync;
  const cliLocator = options.cliLocator ?? createDirectCliLocator();

  return async () => {
    const detected = await Promise.all(
      RECON_TOOL_CATALOG.map(async (definition): Promise<ReconToolSummary | null> => {
        const hasProfile =
          definition.profileDirectory !== null &&
          pathExists(join(homeDirectory, definition.profileDirectory));
        const hasCli = definition.command !== null && (await cliLocator(definition.command));
        if (!hasProfile && !hasCli) return null;
        const detection: ReconToolDetection =
          hasProfile && hasCli ? 'BOTH' : hasCli ? 'CLI' : 'PROFILE';
        return Object.freeze({
          id: definition.id,
          name: definition.name,
          category: definition.category,
          vendor: definition.vendor,
          detection,
        });
      }),
    );
    const tools = Object.freeze(detected.filter((tool): tool is ReconToolSummary => tool !== null));
    return Object.freeze({
      schemaVersion: 1,
      mode: 'READ_ONLY',
      source: 'AI_SPY',
      observedAt: clock().toISOString(),
      catalogCount: RECON_TOOL_CATALOG.length,
      installedCount: tools.length,
      tools,
      restrictedCapabilities: Object.freeze([
        'COMMAND_EXECUTION_DISABLED',
        'KEY_MANAGEMENT_DISABLED',
        'NETWORK_SCAN_DISABLED',
      ] as const),
    });
  };
}
