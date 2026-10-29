import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { runBuild } from '../src/build/run-build.ts';

test('runBuild connects every stage, writes expected artifacts, and reports timings', async () => {
  const root = '/project';
  const outDir = join(root, 'output');
  const calls: string[] = [];
  const lines: string[] = [];
  const times = [0, 100, 400, 400, 900, 900, 1700, 1700, 2900, 3000];
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

  const result = await runBuild({
    cwd: root, inputPath: 'song.mp3', now: () => times.shift()!,
    log: (line) => lines.push(line),
    dependencies: {
      loadConfig: async () => ({
        difficulty: 'normal', seed: 12345, outDir, cover: null,
        layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
      }),
      resolveInputs: async () => ({
        mode: 'mp3', audioPath: join(root, 'song.mp3'),
        lrcPath: join(root, 'song.lrc'), coverPath: join(root, 'song.png'),
      }),
      preflight: async () => { calls.push('preflight'); },
      mkdir: async () => undefined,
      createBackground: async (options) => {
        calls.push(`background:${options.outputPath}`);
        return { path: options.outputPath, media };
      },
      analyzeAudio: async () => {
        calls.push('chart');
        return { analysis: { duration: 10 }, tempo: { bpm: 120 } } as never;
      },
      generateChart: () => chart,
      writeChartAtomic: async (_chart, path) => path,
      renderOverlay: async (options) => {
        calls.push(`overlay:${options.outputPath}`);
        return { path: options.outputPath, media, frameCount: 300 };
      },
      composeFinal: async (options) => {
        calls.push(`final:${options.outputPath}`);
        return { path: options.outputPath, media, elapsedMs: 1200 };
      },
    },
  });

  assert.deepEqual(calls, [
    'preflight',
    `background:${join(outDir, 'background.mp4')}`,
    'chart',
    `overlay:${join(outDir, 'overlay.mov')}`,
    `final:${join(outDir, 'final.mp4')}`,
  ]);
  assert.equal(result.finalPath, join(outDir, 'final.mp4'));
  assert.deepEqual(result.elapsedMs, {
    background: 300, chart: 500, overlay: 800, final: 1200, total: 3000,
  });
  assert(lines.some((line) => line.includes('background') && line.includes('0.30秒')));
  assert(lines.some((line) => line.includes('合計') && line.includes('3.00秒')));
  assert(lines.some((line) => line.includes(join(outDir, 'final.mp4'))));
});
