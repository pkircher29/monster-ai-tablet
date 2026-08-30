import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const userProfile = process.env.USERPROFILE;
const appData = process.env.APPDATA;

if (!userProfile || !appData) {
  console.error('USERPROFILE and APPDATA are required.');
  process.exit(1);
}

const openClawEntry = join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
const environmentWriter = fileURLToPath(
  new URL('./set-user-environment-secret.vbs', import.meta.url),
);
if (!existsSync(openClawEntry)) {
  console.error('The active OpenClaw npm installation was not found.');
  process.exit(1);
}

const token = randomBytes(32).toString('base64url');
const secretEnvironment = {
  ...process.env,
  MAH_NEW_GATEWAY_TOKEN: token,
};

const persistResult = spawnSync('cscript.exe', ['//nologo', environmentWriter], {
  env: secretEnvironment,
  encoding: 'utf8',
});

if (persistResult.status !== 0) {
  console.error('Failed to persist the gateway token in the Windows user environment.');
  if (persistResult.stderr) console.error(persistResult.stderr.trim());
  process.exit(persistResult.status ?? 1);
}

const configureResult = spawnSync(
  process.execPath,
  [
    openClawEntry,
    'config',
    'set',
    'gateway.auth.token',
    '--ref-provider',
    'default',
    '--ref-source',
    'env',
    '--ref-id',
    'OPENCLAW_GATEWAY_TOKEN',
  ],
  {
    env: {
      ...process.env,
      OPENCLAW_GATEWAY_TOKEN: token,
    },
    encoding: 'utf8',
  },
);

if (configureResult.status !== 0) {
  console.error('Failed to replace the plaintext gateway token with an environment SecretRef.');
  if (configureResult.stderr) console.error(configureResult.stderr.trim());
  process.exit(configureResult.status ?? 1);
}

console.log('OpenClaw gateway token rotated and replaced with an environment SecretRef.');
