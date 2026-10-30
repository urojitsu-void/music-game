import { randomUUID } from 'node:crypto';
import {
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rename as nodeRename,
  rm as nodeRm,
  stat as nodeStat,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';

interface LockOwner {
  readonly pid: number;
  readonly token: string;
  readonly startedAt: string;
}

export interface BuildLockFileSystem {
  readonly mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
  readonly rm: (path: string, options: { recursive: boolean; force?: boolean }) => Promise<void>;
  readonly stat: (path: string) => Promise<unknown>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
}

export interface AcquireBuildLockOptions {
  readonly pid?: number;
  readonly token?: () => string;
  readonly now?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
  readonly fs?: Partial<BuildLockFileSystem>;
}

export interface BuildLockHandle {
  readonly token: string;
  readonly release: () => Promise<void>;
}

const DEFAULT_FILE_SYSTEM: BuildLockFileSystem = {
  mkdir: nodeMkdir,
  readFile: nodeReadFile,
  rename: nodeRename,
  rm: nodeRm,
  stat: nodeStat,
  writeFile: nodeWriteFile,
};

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as NodeJS.ErrnoException).code === code;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, 'EPERM');
  }
}

function parseOwner(contents: string): LockOwner | null {
  try {
    const value: unknown = JSON.parse(contents);
    if (typeof value !== 'object' || value === null) return null;
    const owner = value as Record<string, unknown>;
    if (!Number.isInteger(owner.pid) || (owner.pid as number) <= 0) return null;
    if (typeof owner.token !== 'string' || owner.token.length === 0) return null;
    if (typeof owner.startedAt !== 'string' || !Number.isFinite(Date.parse(owner.startedAt))) return null;
    return owner as unknown as LockOwner;
  } catch {
    return null;
  }
}

async function readOwner(fs: BuildLockFileSystem, directory: string): Promise<LockOwner | null> {
  try {
    return parseOwner(await fs.readFile(join(directory, 'owner.json'), 'utf8'));
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
}

async function directoryExists(fs: BuildLockFileSystem, directory: string): Promise<boolean> {
  try {
    await fs.stat(directory);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function createOwnedDirectory(
  fs: BuildLockFileSystem,
  directory: string,
  owner: LockOwner,
): Promise<boolean> {
  try {
    await fs.mkdir(directory);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
  try {
    await fs.writeFile(join(directory, 'owner.json'), `${JSON.stringify(owner)}\n`);
    return true;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function releaseOwnedDirectory(
  fs: BuildLockFileSystem,
  directory: string,
  token: string,
): Promise<void> {
  const owner = await readOwner(fs, directory);
  if (owner?.token === token) await fs.rm(directory, { recursive: true, force: true });
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function acquireBuildLock(
  outputDir: string,
  options: AcquireBuildLockOptions = {},
): Promise<BuildLockHandle> {
  const fs = { ...DEFAULT_FILE_SYSTEM, ...options.fs };
  const pid = options.pid ?? process.pid;
  const createToken = options.token ?? randomUUID;
  const now = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const lockDir = join(outputDir, '.build.lock');
  const recoveryDir = join(outputDir, '.build.lock.recovery');
  await fs.mkdir(outputDir, { recursive: true });

  const newOwner = (): LockOwner => ({
    pid,
    token: createToken(),
    startedAt: new Date(now()).toISOString(),
  });
  const lockedError = (owner: LockOwner): Error =>
    new Error(`Build lock is already held by live PID ${owner.pid}.`);

  const makeHandle = (owner: LockOwner): BuildLockHandle => ({
    token: owner.token,
    release: () => releaseLock(owner.token),
  });

  const recoverRecoveryDirectory = async (): Promise<BuildLockHandle | null> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const owner = newOwner();
      if (await createOwnedDirectory(fs, recoveryDir, owner)) {
        return {
          token: owner.token,
          release: () => releaseOwnedDirectory(fs, recoveryDir, owner.token),
        };
      }

      const existing = await readOwner(fs, recoveryDir);
      if (existing && await isProcessAlive(existing.pid)) return null;
      const quarantine = `${recoveryDir}.stale-${createToken()}`;
      try {
        await fs.rename(recoveryDir, quarantine);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) continue;
        throw error;
      }
      const moved = await readOwner(fs, quarantine);
      if (existing && moved?.token !== existing.token) {
        try {
          await fs.rename(quarantine, recoveryDir);
        } catch (error) {
          if (!hasCode(error, 'EEXIST')) throw error;
        }
        continue;
      }
      await fs.rm(quarantine, { recursive: true, force: true });
    }
    throw new Error('Could not recover the build lock recovery directory.');
  };

  const acquireUnderRecovery = async (): Promise<BuildLockHandle> => {
    const existing = await readOwner(fs, lockDir);
    if (existing && await isProcessAlive(existing.pid)) throw lockedError(existing);

    if (await directoryExists(fs, lockDir)) {
      const quarantine = `${lockDir}.stale-${createToken()}`;
      try {
        await fs.rename(lockDir, quarantine);
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
      const moved = await readOwner(fs, quarantine);
      if (existing && moved?.token !== existing.token) {
        try {
          await fs.rename(quarantine, lockDir);
        } catch (error) {
          if (!hasCode(error, 'EEXIST')) throw error;
        }
        throw new Error('Build lock owner changed during stale recovery; retry the build.');
      }
      await fs.rm(quarantine, { recursive: true, force: true });
    }

    const owner = newOwner();
    if (!await createOwnedDirectory(fs, lockDir, owner)) {
      const replacement = await readOwner(fs, lockDir);
      if (replacement && await isProcessAlive(replacement.pid)) throw lockedError(replacement);
      throw new Error('Build lock changed during stale recovery; retry the build.');
    }
    return makeHandle(owner);
  };

  const releaseLock = async (token: string): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const recovery = await recoverRecoveryDirectory();
      if (!recovery) {
        await nextTurn();
        continue;
      }
      try {
        await releaseOwnedDirectory(fs, lockDir, token);
        return;
      } finally {
        await recovery.release();
      }
    }
    throw new Error('Could not release build lock after repeated recovery contention.');
  };

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await directoryExists(fs, recoveryDir)) {
      const recovery = await recoverRecoveryDirectory();
      if (!recovery) {
        await nextTurn();
        continue;
      }
      try {
        return await acquireUnderRecovery();
      } finally {
        await recovery.release();
      }
    }

    const owner = newOwner();
    if (await createOwnedDirectory(fs, lockDir, owner)) return makeHandle(owner);
    const existing = await readOwner(fs, lockDir);
    if (existing && await isProcessAlive(existing.pid)) throw lockedError(existing);

    const recovery = await recoverRecoveryDirectory();
    if (!recovery) {
      await nextTurn();
      continue;
    }
    try {
      return await acquireUnderRecovery();
    } finally {
      await recovery.release();
    }
  }
  throw new Error('Could not acquire build lock after repeated contention.');
}
