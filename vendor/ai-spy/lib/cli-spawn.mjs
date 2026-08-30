import { spawnSync } from 'node:child_process';

const COMMAND_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const windowsInvocations = new Map();

function windowsInvocation(command) {
  const cached = windowsInvocations.get(command);
  if (cached) return cached;
  const found = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
    shell: false,
  });
  const paths = String(found.stdout || '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const executable = paths.find((entry) => /\.(?:exe|com)$/i.test(entry));
  const powerShellShim = paths.find((entry) => /\.ps1$/i.test(entry));
  const invocation = executable
    ? { command: executable, prefix: [] }
    : powerShellShim
      ? {
          command: 'powershell.exe',
          prefix: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            powerShellShim,
          ],
        }
      : { command, prefix: [] };
  windowsInvocations.set(command, invocation);
  return invocation;
}

export function spawnCliSync(command, args, options = {}) {
  if (
    !COMMAND_RE.test(command) ||
    !Array.isArray(args) ||
    args.some((value) => typeof value !== 'string')
  ) {
    throw new TypeError('invalid CLI invocation');
  }
  const invocation =
    process.platform === 'win32' ? windowsInvocation(command) : { command, prefix: [] };
  return spawnSync(invocation.command, [...invocation.prefix, ...args], {
    ...options,
    windowsHide: true,
    shell: false,
  });
}
