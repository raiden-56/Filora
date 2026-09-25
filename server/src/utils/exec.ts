import { spawn } from 'node:child_process';
import { config } from '../config/index.js';
import { AppError } from './errors.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** resolve even when exit code != 0 */
  allowFailure?: boolean;
  signal?: AbortSignal;
  /** cap on captured output */
  maxOutput?: number;
}

/**
 * Run an external binary with an argument array (never a shell string, so user-supplied
 * filenames cannot inject commands). Kills the process on timeout.
 */
export function run(bin: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? config.processTimeoutMs;
  const maxOutput = opts.maxOutput ?? 1_000_000;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    const child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (finished) return;
      child.kill('SIGKILL');
      finished = true;
      reject(new AppError('TIMEOUT', undefined, { details: `${bin} timed out after ${timeoutMs}ms` }));
    }, timeoutMs);
    const onAbort = () => {
      if (finished) return;
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < maxOutput) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < maxOutput) stderr += d.toString();
    });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (code !== 0 && !opts.allowFailure) {
        reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(0, 2000) || stdout.slice(0, 2000)}`));
      } else resolve({ stdout, stderr, code });
    });
  });
}
