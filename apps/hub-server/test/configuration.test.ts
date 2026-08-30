import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadHubLocalConfiguration } from '../dist/index.js';

test('loads the admin password only from a bounded local file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'monster-hub-config-'));
  try {
    await mkdir(join(root, '.monster-hub'));
    const passwordFile = join(root, '.monster-hub', 'admin-password.txt');
    await writeFile(passwordFile, 'correct horse tablet battery\r\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    const configuration = await loadHubLocalConfiguration({}, root);
    assert.equal(configuration.adminPassword, 'correct horse tablet battery');
    assert.equal(configuration.passwordFile, passwordFile);

    await writeFile(passwordFile, 'too-short\n', 'utf8');
    await assert.rejects(loadHubLocalConfiguration({}, root), /password file/);

    await writeFile(passwordFile, `valid password with newline\nsecond line\n`, 'utf8');
    await assert.rejects(loadHubLocalConfiguration({}, root), /one safe password/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
