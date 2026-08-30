import { spawn } from 'node:child_process';

import type { AgentProbeCommand, AgentProbeResult } from './types.js';

function validateCommand(command: AgentProbeCommand): void {
  if (
    command.executable.length === 0 ||
    command.executable.includes('\0') ||
    command.args.length > 16 ||
    command.args.some((argument) => argument.length > 2_048 || argument.includes('\0')) ||
    !Number.isSafeInteger(command.timeoutMs) ||
    command.timeoutMs < 1 ||
    command.timeoutMs > 10_000 ||
    !Number.isSafeInteger(command.maxOutputBytes) ||
    command.maxOutputBytes < 1 ||
    command.maxOutputBytes > 32 * 1_024
  ) {
    throw new TypeError('Invalid server-owned agent probe command.');
  }
}

export function runAgentProbeCommand(command: AgentProbeCommand): Promise<AgentProbeResult> {
  validateCommand(command);
  return new Promise((resolve) => {
    const child = spawn(command.executable, [...command.args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const stop = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      const remaining = command.maxOutputBytes - outputBytes;
      if (remaining <= 0) {
        truncated = true;
        stop();
        return;
      }
      const accepted = chunk.subarray(0, remaining);
      target.push(accepted);
      outputBytes += accepted.byteLength;
      if (accepted.byteLength < chunk.byteLength) {
        truncated = true;
        stop();
      }
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdoutChunks, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderrChunks, chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, command.timeoutMs);
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        truncated,
      });
    };
    child.once('error', () => finish(null));
    child.once('close', (exitCode) => finish(exitCode));
  });
}
