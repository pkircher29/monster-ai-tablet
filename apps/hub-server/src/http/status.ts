import { createLiveAgentStatusProvider, runAgentProbeCommand } from '../agent-status/index.js';
import type { AgentStatusProvider } from './types.js';

export function createDefaultAgentStatusProvider(clock: () => Date): AgentStatusProvider {
  return createLiveAgentStatusProvider({
    clock,
    runner: { run: runAgentProbeCommand },
  });
}
