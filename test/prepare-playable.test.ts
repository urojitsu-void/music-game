import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { preparePlayable } from '../src/build/prepare-playable.ts';

test('preparePlayable generates only background.mp4 and chart.json under one build lock', async () => {
  const root = '/project';
  const outDir = join(root, 'data', 'Test Song');
  const calls: string[] = [];
  const media = {
    durationSec: 10,
    video: {
      index: 0, codec: 'h264', encodedWidth: 1280, encodedHeight: 720,
      displayWidth: 1280, displayHeight: 720, rotationDeg: 0,
      avgFps: 30, isVfr: false, startSec: 0, durationSec: 10,
    },
    audio: {
      index: 1, codec: 'aac', sampleRate: 48000, channels: 2,
      startSec: 0, durationSec: 10,
    },
  } as const;
  const chart = { duration: 10 } as never;

  const result = await preparePlayable({
    cwd: root, inputPath: 'music/Test Song.mp3', subtitle: null, outDir,
    dependencies: {
      loadConfig: async (options) => {
        assert.equal(options.cli?.outDir, outDir);
        return {
          difficulty: 'normal', seed: 12345, outDir, cover: null,
          layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
        };
      },
      resolveInputs: async (options) => {
        assert.equal(options.subtitle, null);
        return {
          mode: 'mp3', audioPath: join(root, 'music', 'Test Song.mp3'),
          subtitlePath: null, coverPath: join(root, 'music', 'Test Song.png'),
        };
      },
      preflight: async () => { calls.push('preflight'); },
      mkdir: async () => undefined,
      acquireBuildLock: async () => {
        calls.push('lock:acquire');
        return { token: 'test-lock', release: async () => { calls.push('lock:release'); } };
      },
      createBackground: async (options) => {
        calls.push(`background:${options.outputPath}`);
        return { path: options.outputPath, media };
      },
      analyzeAudio: async () => {
        calls.push('chart');
        return { analysis: { duration: 10 }, tempo: { bpm: 120 } } as never;
      },
      generateChart: () => chart,
      writeChartAtomic: async (_chart, path) => {
        calls.push(`write:${path}`);
        return path;
      },
    },
  });

  assert.deepEqual(calls, [
    'preflight', 'lock:acquire',
    `background:${join(outDir, 'background.mp4')}`,
    'chart', `write:${join(outDir, 'chart.json')}`, 'lock:release',
  ]);
  assert.equal(result.backgroundPath, join(outDir, 'background.mp4'));
  assert.equal(result.chartPath, join(outDir, 'chart.json'));
});

test('preparePlayable releases the build lock when preparation fails', async () => {
  let released = false;
  await assert.rejects(preparePlayable({
    cwd: '/project', inputPath: 'song.mp3', outDir: '/project/data/song',
    dependencies: {
      loadConfig: async () => ({
        difficulty: 'normal', seed: 12345, outDir: '/project/data/song', cover: null,
        layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
      }),
      resolveInputs: async () => ({
        mode: 'mp3', audioPath: '/project/song.mp3',
        subtitlePath: null, coverPath: '/project/song.png',
      }),
      preflight: async () => undefined,
      mkdir: async () => undefined,
      acquireBuildLock: async () => ({
        token: 'failing-lock', release: async () => { released = true; },
      }),
      createBackground: async () => { throw new Error('background failed'); },
    },
  }), /background failed/);
  assert.equal(released, true);
});
