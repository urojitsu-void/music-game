import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { runDataBuild } from '../src/build/run-data-build.ts';

test('runDataBuild writes playable data to data/<input stem>', async () => {
  const calls: unknown[] = [];
  const result = await runDataBuild({
    cwd: '/project', inputPath: '/music/Test Song.mp3', subtitle: null,
    dependencies: {
      preparePlayable: async (options) => {
        calls.push(options);
        return {
          backgroundPath: join(options.outDir!, 'background.mp4'),
          chartPath: join(options.outDir!, 'chart.json'),
          elapsedMs: { background: 1, chart: 2, total: 3 },
        } as never;
      },
    },
  });

  const outDir = join('/project', 'data', 'Test Song');
  assert.deepEqual(calls, [{
    cwd: '/project', inputPath: '/music/Test Song.mp3', subtitle: null, outDir,
  }]);
  assert.equal(result.outDir, outDir);
  assert.equal(result.backgroundPath, join(outDir, 'background.mp4'));
  assert.equal(result.chartPath, join(outDir, 'chart.json'));
});
