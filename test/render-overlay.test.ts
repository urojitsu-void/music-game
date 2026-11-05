import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';

import {
  buildOverlayArgs,
  frameCountForDuration,
  frameTime,
  renderOverlay,
} from '../src/video/render-overlay.ts';
import type { Chart } from '../src/chart/schema.ts';
import type { ProbeMetadata } from '../src/media/probe.ts';

test('frame count and timestamps are exact at 30fps', () => {
  assert.equal(frameCountForDuration(5), 150);
  assert.equal(frameCountForDuration(5.001), 151);
  assert.equal(frameTime(0), 0);
  assert.equal(frameTime(149), 149 / 30);
});

test('buildOverlayArgs streams raw RGBA into ProRes 4444', () => {
  const args = buildOverlayArgs({
    width: 1280, height: 720, durationSec: 5,
    outputPath: '/out/gameplay-alpha.tmp.mov',
  });
  for (const expected of [
    'rawvideo', 'rgba', '1280x720', '30', 'prores_ks', '4444', 'yuva444p10le', '5',
  ]) assert(args.includes(expected), `missing ${expected}`);
  assert.equal(args.includes('png'), false);
  assert.equal(args.at(-1), '/out/gameplay-alpha.tmp.mov');
});

test('renderOverlay reuses the shared renderer at exact timestamps and streams raw frames', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'render-overlay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const renderTimes: number[] = [];
  const chunks: Buffer[] = [];
  const outputPath = join(directory, 'gameplay-alpha.mov');
  const spawnProcessFn = (_command: string, args: readonly string[]) => {
    const stdin = new PassThrough();
    stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<void>((resolve, reject) => {
      stdin.once('error', reject);
      stdin.once('finish', () => {
        writeFile(args.at(-1)!, 'mov').then(() => resolve(), reject);
      });
    });
    return { child: { stdin }, completed };
  };
  const backgroundMedia: ProbeMetadata = {
    durationSec: 0.067,
    video: {
      index: 0, codec: 'h264', encodedWidth: 320, encodedHeight: 180,
      displayWidth: 320, displayHeight: 180, rotationDeg: 0,
      avgFps: 30, isVfr: false, startSec: 0, durationSec: 0.067,
    },
    audio: { index: 1, codec: 'aac', sampleRate: 48000, channels: 2, startSec: 0, durationSec: 0.067 },
  };
  const overlayMedia: ProbeMetadata = {
    durationSec: 0.067,
    video: {
      index: 0, codec: 'prores', pixelFormat: 'yuva444p10le',
      encodedWidth: 320, encodedHeight: 180, displayWidth: 320, displayHeight: 180,
      rotationDeg: 0, avgFps: 30, isVfr: false, startSec: 0, durationSec: 0.067,
    },
    audio: null,
  };
  const chart: Chart = {
    formatVersion: 1, audio: 'song.mp3', duration: 0.067, bpm: 120,
    beatOffset: 0, beatsPerBar: 4, difficulty: 'normal', lanes: 4, seed: 1,
    notes: [], statistics: {},
  };

  const result = await renderOverlay({
    chart, backgroundMedia,
    layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
    outputPath, logPath: join(directory, 'build.log'),
    createFrameRendererFn: () => ({
      render(timeSeconds: number) {
        renderTimes.push(timeSeconds);
        return Buffer.from(`png-${renderTimes.length}`);
      },
    }),
    spawnProcessFn,
    probeMediaFn: async () => overlayMedia,
  });

  assert.equal(result.frameCount, 3);
  assert.deepEqual(renderTimes, [0, 1 / 30, 2 / 30]);
  assert.equal(chunks.length, 3);
  assert.equal(await readFile(outputPath, 'utf8'), 'mov');
});

test('renderOverlay creates a real alpha ProRes video with Node Canvas and FFmpeg', {
  skip: process.env.SKIP_FFMPEG_TESTS === '1' ? 'requires FFmpeg' : false,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'render-overlay-integration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const backgroundMedia: ProbeMetadata = {
    durationSec: 0.2,
    video: {
      index: 0, codec: 'h264', encodedWidth: 320, encodedHeight: 180,
      displayWidth: 320, displayHeight: 180, rotationDeg: 0,
      avgFps: 30, isVfr: false, startSec: 0, durationSec: 0.2,
    },
    audio: { index: 1, codec: 'aac', sampleRate: 48000, channels: 2, startSec: 0, durationSec: 0.2 },
  };
  const chart: Chart = {
    formatVersion: 1, audio: 'song.mp3', duration: 0.2, bpm: 120,
    beatOffset: 0, beatsPerBar: 4, difficulty: 'normal', lanes: 4, seed: 1,
    notes: [{ time: 0.1, lane: 1, type: 'tap' }], statistics: {},
  };
  const outputPath = join(directory, 'gameplay-alpha.mov');
  const result = await renderOverlay({
    chart, backgroundMedia,
    layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
    outputPath, logPath: join(directory, 'build.log'),
  });
  assert.equal(result.frameCount, 6);
  assert.equal(result.media.video?.codec, 'prores');
  assert.equal(result.media.video?.pixelFormat, 'yuva444p12le');
  assert.equal(result.media.video?.displayWidth, 320);
  assert.equal(result.media.video?.displayHeight, 180);
});
