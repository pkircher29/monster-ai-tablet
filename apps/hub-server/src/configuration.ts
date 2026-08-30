import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const MAX_PASSWORD_FILE_BYTES = 1_024;

export interface HubLocalConfiguration {
  readonly adminPassword: string;
  readonly passwordFile: string;
}

export async function loadHubLocalConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): Promise<HubLocalConfiguration> {
  const configuredPath = environment.MONSTER_HUB_ADMIN_PASSWORD_FILE;
  const passwordFile = resolve(
    configuredPath === undefined
      ? resolve(repositoryRoot, '.monster-hub', 'admin-password.txt')
      : isAbsolute(configuredPath)
        ? configuredPath
        : resolve(repositoryRoot, configuredPath),
  );
  const metadata = await stat(passwordFile);
  if (!metadata.isFile() || metadata.size < 14 || metadata.size > MAX_PASSWORD_FILE_BYTES) {
    throw new TypeError('Monster Hub admin password file is invalid');
  }
  const raw = await readFile(passwordFile, 'utf8');
  const adminPassword = raw.replace(/[\r\n]+$/, '');
  if (
    adminPassword.length < 14 ||
    adminPassword.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(adminPassword)
  ) {
    throw new TypeError('Monster Hub admin password file must contain one safe password');
  }
  return Object.freeze({ adminPassword, passwordFile });
}
