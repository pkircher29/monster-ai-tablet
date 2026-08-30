import {
  createAgentStatusHistoryStore,
  createLiveAgentStatusProvider,
  defaultAgentStatusDatabasePath,
  runAgentProbeCommand,
  withAgentStatusHistory,
} from '../agent-status/index.js';
import type { AgentStatusProvider } from './types.js';

export function createDefaultAgentStatusProvider(clock: () => Date): AgentStatusProvider {
  const liveProvider = createLiveAgentStatusProvider({
    clock,
    runner: { run: runAgentProbeCommand },
  });
  const historyStore = createAgentStatusHistoryStore({
    databasePath: defaultAgentStatusDatabasePath(),
  });
  return withAgentStatusHistory(liveProvider, historyStore);
}
