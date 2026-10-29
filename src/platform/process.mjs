import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';

const STDERR_LIMIT = 64 * 1024;

function processError(command, code, stderr) {
  const error = new Error(`Command failed (${code}): ${command}`);
  error.command = command;
  error.code = code;
  error.stderr = stderr;
  return error;
}

function appendBounded(current, chunk, limit = STDERR_LIMIT) {
  const combined = current + chunk;
  return combined.length > limit ? combined.slice(-limit) : combined;
}

export function runProcess(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      error.command = command;
      error.stderr = stderr;
      reject(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(processError(command, code, stderr));
      }
    });
  });
}

export function spawnProcess(command, args = [], options = {}) {
  const { stdin = 'pipe', ...spawnOptions } = options;
  const child = spawn(command, args, {
    ...spawnOptions,
    shell: false,
    stdio: [stdin, 'inherit', 'pipe'],
  });
  let stderr = '';
  let settled = false;

  const completed = new Promise((resolve, reject) => {
    const cleanup = () => {
      child.removeListener('error', onChildError);
      child.removeListener('close', onClose);
      child.stderr?.removeListener('data', onStderr);
      child.stdin?.removeListener('error', onStdinError);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onStderr = (chunk) => {
      stderr = appendBounded(stderr, chunk);
    };
    const onChildError = (error) => {
      child.kill();
      error.command = command;
      error.stderr = stderr;
      settle(reject, error);
    };
    const onStdinError = (error) => {
      child.kill();
      error.command = command;
      error.stderr = stderr;
      settle(reject, error);
    };
    const onClose = (code) => {
      if (code === 0) {
        settle(resolve);
      } else {
        settle(reject, processError(command, code, stderr));
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

async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function commandExists(command) {
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
