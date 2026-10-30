import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { acquireBuildLock } from '../src/build/build-lock.ts';

async function fixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'music-build-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const fixedNow = () => Date.parse('2026-10-30T12:00:00.000Z');

test('acquisition is exclusive and a live owner is rejected clearly', async (t) => {
  const outputDir = await fixture(t);
  const first = await acquireBuildLock(outputDir, {
    pid: 101,
    token: () => 'first-token',
    now: fixedNow,
    isProcessAlive: (pid) => pid === 101,
  });

  const owner = JSON.parse(await readFile(join(outputDir, '.build.lock', 'owner.json'), 'utf8'));
  assert.deepEqual(owner, {
    pid: 101,
    token: 'first-token',
    startedAt: '2026-10-30T12:00:00.000Z',
  });
  await assert.rejects(
    acquireBuildLock(outputDir, {
      pid: 202,
      token: () => 'second-token',
      now: fixedNow,
      isProcessAlive: (pid) => pid === 101,
    }),
    /build.*lock.*PID 101|PID 101.*build.*lock/i,
  );

  await first.release();
  await assert.rejects(access(join(outputDir, '.build.lock')), { code: 'ENOENT' });
});

test('a dead owner is recovered', async (t) => {
  const outputDir = await fixture(t);
  const lockDir = join(outputDir, '.build.lock');
  await mkdir(lockDir);
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
    pid: 303,
    token: 'dead-token',
    startedAt: '2026-10-29T00:00:00.000Z',
  }));

  const lock = await acquireBuildLock(outputDir, {
    pid: 404,
    token: () => 'replacement-token',
    now: fixedNow,
    isProcessAlive: () => false,
  });
  const owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(owner.token, 'replacement-token');
  await lock.release();
});

test('malformed and incomplete locks are recovered', async (t) => {
  for (const contents of ['{broken', null]) {
    await t.test(contents === null ? 'incomplete' : 'malformed', async (t) => {
      const outputDir = await fixture(t);
      const lockDir = join(outputDir, '.build.lock');
      await mkdir(lockDir);
      if (contents !== null) await writeFile(join(lockDir, 'owner.json'), contents);

      const lock = await acquireBuildLock(outputDir, {
        pid: 505,
        token: () => `fresh-${contents ?? 'missing'}`,
        now: fixedNow,
        isProcessAlive: () => false,
      });
      assert.equal(JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')).pid, 505);
      await lock.release();
    });
  }
});

test('concurrent acquisition after a stale lock has exactly one winner', async (t) => {
  const outputDir = await fixture(t);
  const lockDir = join(outputDir, '.build.lock');
  await mkdir(lockDir);
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
    pid: 606,
    token: 'stale-token',
    startedAt: '2026-10-29T00:00:00.000Z',
  }));
  let tokenSequence = 0;
  const options = () => ({
    pid: 707,
    token: () => `contender-${++tokenSequence}`,
    now: fixedNow,
    isProcessAlive: (pid: number) => pid === 707,
  });

  const settled = await Promise.allSettled([
    acquireBuildLock(outputDir, options()),
    acquireBuildLock(outputDir, options()),
  ]);
  const winners = settled.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireBuildLock>>> => result.status === 'fulfilled');
  const losers = settled.filter((result) => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  await winners[0]!.value.release();
});

test('a stale recovery owner is itself recovered', async (t) => {
  const outputDir = await fixture(t);
  const recoveryDir = join(outputDir, '.build.lock.recovery');
  await mkdir(recoveryDir);
  await writeFile(join(recoveryDir, 'owner.json'), JSON.stringify({
    pid: 808,
    token: 'dead-recovery',
    startedAt: '2026-10-29T00:00:00.000Z',
  }));

  const lock = await acquireBuildLock(outputDir, {
    pid: 909,
    token: (() => {
      const tokens = ['new-recovery', 'new-lock'];
      return () => tokens.shift() ?? 'extra-token';
    })(),
    now: fixedNow,
    isProcessAlive: () => false,
  });
  const owner = JSON.parse(await readFile(join(outputDir, '.build.lock', 'owner.json'), 'utf8'));
  assert.equal(owner.token, lock.token);
  await lock.release();
  await assert.rejects(access(recoveryDir), { code: 'ENOENT' });
});

test('release leaves the lock in place when the owner token does not match', async (t) => {
  const outputDir = await fixture(t);
  const lock = await acquireBuildLock(outputDir, {
    pid: 1001,
    token: () => 'original-token',
    now: fixedNow,
    isProcessAlive: () => true,
  });
  const ownerPath = join(outputDir, '.build.lock', 'owner.json');
  await writeFile(ownerPath, JSON.stringify({
    pid: 1002,
    token: 'other-token',
    startedAt: '2026-10-30T12:01:00.000Z',
  }));

  await lock.release();
  assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token, 'other-token');
});

test('a delayed old release cannot delete a replacement lock', async (t) => {
  const outputDir = await fixture(t);
  const oldLock = await acquireBuildLock(outputDir, {
    pid: 1101,
    token: () => 'old-token',
    now: fixedNow,
    isProcessAlive: () => true,
  });
  await rm(join(outputDir, '.build.lock'), { recursive: true });
  const replacement = await acquireBuildLock(outputDir, {
    pid: 1102,
    token: () => 'replacement-token',
    now: fixedNow,
    isProcessAlive: () => true,
  });

  await oldLock.release();
  const ownerPath = join(outputDir, '.build.lock', 'owner.json');
  assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token, 'replacement-token');
  await replacement.release();
});
