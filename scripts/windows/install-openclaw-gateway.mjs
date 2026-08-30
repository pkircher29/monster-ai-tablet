import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const appData = process.env.APPDATA;
if (!appData) {
  console.error('APPDATA is required.');
  process.exit(1);
}

const openClawEntry = join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
const environmentReader = fileURLToPath(
  new URL('./get-user-environment-secret.vbs', import.meta.url),
);

if (!existsSync(openClawEntry)) {
  console.error('The active OpenClaw npm installation was not found.');
  process.exit(1);
}

const readResult = spawnSync('cscript.exe', ['//nologo', environmentReader], {
  encoding: 'utf8',
});
const token = readResult.stdout?.trim();

if (readResult.status !== 0 || !token) {
  console.error('OPENCLAW_GATEWAY_TOKEN is missing from the Windows user environment.');
  process.exit(1);
}

const openClawEnvironment = {
  ...process.env,
  OPENCLAW_GATEWAY_TOKEN: token,
};

function runOpenClaw(label, args) {
  const result = spawnSync(process.execPath, [openClawEntry, ...args], {
    env: openClawEnvironment,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    console.error(`FAIL ${label} (exit ${result.status ?? 'unknown'})`);
    process.exit(result.status ?? 1);
  }

  console.log(`PASS ${label}`);
}

runOpenClaw('OpenClaw configuration validation', ['config', 'validate']);
runOpenClaw('OpenClaw Gateway scheduled task installation', [
  'gateway',
  'install',
  '--force',
  '--runtime',
  'node',
  '--port',
  '18789',
]);
runOpenClaw('OpenClaw Gateway start request', ['gateway', 'start']);
