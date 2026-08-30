import { spawn } from 'node:child_process';

const LOCATOR_TIMEOUT_MS = 2_000;
const SAFE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type CliLocator = (command: string) => Promise<boolean>;

export function createDirectCliLocator(platform = process.platform): CliLocator {
  const executable = platform === 'win32' ? 'where.exe' : 'which';
  return async (command) => {
    if (!SAFE_COMMAND.test(command)) return false;
    return await new Promise<boolean>((resolve) => {
      const child = spawn(executable, [command], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      let settled = false;
      const finish = (found: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(found);
      };
      const timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        finish(false);
      }, LOCATOR_TIMEOUT_MS);
      child.once('error', () => finish(false));
      child.once('close', (exitCode) => finish(exitCode === 0));
    });
  };
}
