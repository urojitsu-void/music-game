import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { writeStageErrorLog } from '../src/platform/stage-log.ts';

test('writeStageErrorLog atomically writes complete diagnostics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stage-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, 'build.log');
  await writeStageErrorLog({
    logPath,
    stage: 'overlay',
    command: 'ffmpeg-custom',
    args: ['-i', 'path with spaces.mp4'],
    code: 7,
    stderr: 'complete\nstderr',
  });
  assert.deepEqual(JSON.parse(await readFile(logPath, 'utf8')), {
    stage: 'overlay', command: 'ffmpeg-custom',
    arguments: ['-i', 'path with spaces.mp4'], code: 7,
    stderr: 'complete\nstderr',
  });
  await assert.rejects(readFile(`${logPath}.tmp`), { code: 'ENOENT' });
});
