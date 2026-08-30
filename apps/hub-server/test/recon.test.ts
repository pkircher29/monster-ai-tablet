import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createToolReconProvider } from '../dist/index.js';

test('adapts AI-Spy inventory into a closed path-free host snapshot', async () => {
  const checkedProfiles: string[] = [];
  const checkedCommands: string[] = [];
  const provider = createToolReconProvider({
    clock: () => new Date('2026-08-30T09:00:00.000Z'),
    homeDirectory: 'C:\\Users\\PrivateOperator',
    pathExists(path) {
      checkedProfiles.push(path);
      return path.endsWith('\\.claude') || path.endsWith('\\.ollama');
    },
    async cliLocator(command) {
      checkedCommands.push(command);
      return command === 'claude' || command === 'opencode';
    },
  });

  const snapshot = await provider();

  assert.equal(snapshot.catalogCount, 14);
  assert.equal(snapshot.installedCount, 3);
  assert.deepEqual(snapshot.tools, [
    {
      id: 'claude-code',
      name: 'Claude Code',
      category: 'HARNESS',
      vendor: 'Anthropic',
      detection: 'BOTH',
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      category: 'HARNESS',
      vendor: 'SST',
      detection: 'CLI',
    },
    {
      id: 'ollama',
      name: 'Ollama',
      category: 'LOCAL_MODEL',
      vendor: 'Ollama',
      detection: 'PROFILE',
    },
  ]);
  assert.deepEqual(snapshot.restrictedCapabilities, [
    'COMMAND_EXECUTION_DISABLED',
    'KEY_MANAGEMENT_DISABLED',
    'NETWORK_SCAN_DISABLED',
  ]);
  assert.ok(checkedProfiles.every((path) => path.startsWith('C:\\Users\\PrivateOperator\\.')));
  assert.ok(checkedCommands.includes('claude'));
  assert.doesNotMatch(
    JSON.stringify(snapshot).toLowerCase(),
    /privateoperator|clipath|commandline|executable|stderr|stdout|token|secret|pricing/,
  );
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.tools));
});
