import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const appData = process.env.APPDATA;
if (!appData) {
  console.error('FAIL APPDATA is unavailable');
  process.exit(1);
}

const openClawEntry = join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
const environmentReader = fileURLToPath(
  new URL('./get-user-environment-secret.vbs', import.meta.url),
);

if (!existsSync(openClawEntry)) {
  console.error('FAIL active OpenClaw installation is missing');
  process.exit(1);
}

const readResult = spawnSync('cscript.exe', ['//nologo', environmentReader], {
  encoding: 'utf8',
});
const token = readResult.stdout?.trim();

if (readResult.status !== 0 || !token) {
  console.error('FAIL gateway SecretRef is unresolved');
  process.exit(1);
}

const environment = {
  ...process.env,
  OPENCLAW_GATEWAY_TOKEN: token,
};

let healthResult;
for (let attempt = 0; attempt < 10; attempt += 1) {
  healthResult = spawnSync(process.execPath, [openClawEntry, 'gateway', 'health'], {
    env: environment,
    encoding: 'utf8',
  });
  if (healthResult.status === 0) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
}

if (healthResult?.status !== 0) {
  console.error('FAIL authenticated local Gateway health check');
  process.exit(healthResult?.status ?? 1);
}

console.log('PASS OpenClaw Gateway token SecretRef resolves');
console.log('PASS authenticated local Gateway health check');
