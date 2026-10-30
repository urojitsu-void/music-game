import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import {
  spawn, type ChildProcess, type ChildProcessByStdio, type SpawnOptions, type StdioOptions,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

export class ProcessExecutionError extends Error {
  readonly command: string;
  readonly code: number | null;
  readonly stderr: string;

  constructor(command: string, code: number | null, stderr: string) {
    super(`Command failed (${code}): ${command}`);
    this.command = command;
    this.code = code;
    this.stderr = stderr;
  }
}

interface ProcessDiagnostics {
  readonly command: string;
  readonly stderr: string;
}

type SpawnProcessOptions = SpawnOptions & {
  stdin?: Exclude<StdioOptions, string>[number];
};

interface SpawnProcessResult<Child extends ChildProcess = ChildProcess> {
  child: Child;
  completed: Promise<void>;
}

const STDERR_LIMIT = 64 * 1024;

export class ProcessSupervisor {
  readonly #children = new Set<ChildProcess>();
  #shuttingDown = false;
  #shutdownPromise: Promise<void> | undefined;

  get activeCount(): number { return this.#children.size; }

  spawn(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
    if (this.#shuttingDown) throw new Error('Process supervisor is shutting down');
    const child = spawn(command, args, options);
    this.#children.add(child);
    child.once('close', () => { this.#children.delete(child); });
    return child;
  }

  shutdown(options: { readonly graceMs?: number } = {}): Promise<void> {
    if (this.#shutdownPromise) {
      for (const child of this.#children) child.kill('SIGKILL');
      return this.#shutdownPromise;
    }
    this.#shuttingDown = true;
    const graceMs = options.graceMs ?? 3000;
    const children = [...this.#children];
    const allClosed = Promise.all(children.map((child) => (
      this.#children.has(child)
        ? new Promise<void>((resolve) => { child.once('close', () => resolve()); })
        : Promise.resolve()
    ))).then(() => undefined);
    for (const child of children) child.kill('SIGTERM');
    this.#shutdownPromise = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        allClosed,
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, graceMs); }),
      ]);
      if (timeout) clearTimeout(timeout);
      for (const child of this.#children) child.kill('SIGKILL');
      await allClosed;
    })();
    return this.#shutdownPromise;
  }
}

export const processSupervisor = new ProcessSupervisor();

function withProcessDiagnostics<T extends Error>(
  error: T, command: string, stderr: string,
): T & ProcessDiagnostics {
  return Object.assign(error, { command, stderr });
}

function appendBounded(current: string, chunk: string, limit = STDERR_LIMIT): string {
  const combined = current + chunk;
  return combined.length > limit ? combined.slice(-limit) : combined;
}

export function runProcess(
  command: string, args: readonly string[] = [], options: SpawnOptions = {},
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = processSupervisor.spawn(command, args, {
      ...options,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      reject(withProcessDiagnostics(error, command, stderr));
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new ProcessExecutionError(command, code, stderr));
      }
    });
  });
}

export function spawnProcess(
  command: string, args?: readonly string[], options?: SpawnOptions & { stdin?: 'pipe' },
): SpawnProcessResult<ChildProcessByStdio<Writable, null, Readable>>;
export function spawnProcess(
  command: string, args: readonly string[], options: SpawnProcessOptions,
): SpawnProcessResult;
export function spawnProcess(
  command: string, args: readonly string[] = [], options: SpawnProcessOptions = {},
): SpawnProcessResult {
  const { stdin = 'pipe', ...spawnOptions } = options;
  const child = processSupervisor.spawn(command, args, {
    ...spawnOptions,
    shell: false,
    stdio: [stdin, 'inherit', 'pipe'],
  });
  let stderr = '';
  let settled = false;

  const completed = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.removeListener('error', onChildError);
      child.removeListener('close', onClose);
      child.stderr?.removeListener('data', onStderr);
      child.stdin?.removeListener('error', onStdinError);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onStderr = (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    };
    const onChildError = (error: Error) => {
      child.kill();
      settle(withProcessDiagnostics(error, command, stderr));
    };
    const onStdinError = (error: Error) => {
      child.kill();
      settle(withProcessDiagnostics(error, command, stderr));
    };
    const onClose = (code: number | null) => {
      if (code === 0) {
        settle();
      } else {
        settle(new ProcessExecutionError(command, code, stderr));
      }
    };

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', onStderr);
    child.once('error', onChildError);
    child.once('close', onClose);
    child.stdin?.once('error', onStdinError);
  });

  return { child, completed };
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function commandExists(command: string): Promise<boolean> {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return isExecutable(command);
  }

  const directories = (process.env.PATH ?? '').split(delimiter);
  const extensions = process.platform === 'win32' && !extname(command)
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const directory of directories) {
    for (const extension of extensions) {
      if (await isExecutable(join(directory, command + extension))) return true;
    }
  }
  return false;
}
