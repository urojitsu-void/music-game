import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseProbe, preflight } from '../src/media/probe.ts';

const format = { duration: '5.0' };

test('parseProbe parses audio-only media', () => {
  const result = parseProbe({
    format,
    streams: [{
      index: 0, codec_type: 'audio', codec_name: 'mp3',
      sample_rate: '44100', channels: 2, start_time: '0.025', duration: '4.9',
    }],
  });

  assert.deepEqual(result, {
    durationSec: 5,
    video: null,
    audio: {
      index: 0, codec: 'mp3', sampleRate: 44100, channels: 2,
      startSec: 0.025, durationSec: 4.9,
    },
  });
});

test('parseProbe detects VFR and falls back to format duration', () => {
  const result = parseProbe({
    format,
    streams: [
      {
        index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
        avg_frame_rate: '30000/1001', r_frame_rate: '30/1', start_time: 'N/A', duration: 'N/A',
      },
      {
        index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2,
        start_time: '0', duration: '4.8',
      },
    ],
  });

  assert.equal(result.video?.avgFps, 30000 / 1001);
  assert.equal(result.video?.isVfr, true);
  assert.equal(result.video?.startSec, 0);
  assert.equal(result.video?.durationSec, 5);
});

test('parseProbe applies rotation to display dimensions', () => {
  const result = parseProbe({
    format,
    streams: [
      {
        index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
        avg_frame_rate: '30/1', r_frame_rate: '30/1',
        side_data_list: [{ rotation: -90 }],
      },
      { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
    ],
  });

  assert.deepEqual(result.video, {
    index: 0,
    codec: 'h264',
    encodedWidth: 1920,
    encodedHeight: 1080,
    displayWidth: 1080,
    displayHeight: 1920,
    rotationDeg: 270,
    avgFps: 30,
    isVfr: false,
    startSec: 0,
    durationSec: 5,
  });
});

test('parseProbe selects the lowest indexed video and audio streams', () => {
  const result = parseProbe({
    format,
    streams: [
      { index: 8, codec_type: 'audio', codec_name: 'opus', sample_rate: '48000', channels: 1 },
      { index: 5, codec_type: 'video', codec_name: 'hevc', width: 640, height: 360, avg_frame_rate: '24/1', r_frame_rate: '24/1' },
      { index: 2, codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 },
      { index: 1, codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', r_frame_rate: '30/1' },
    ],
  });

  assert.equal(result.video?.index, 1);
  assert.equal(result.video?.codec, 'h264');
  assert.equal(result.audio?.index, 2);
  assert.equal(result.audio?.codec, 'aac');
});

test('parseProbe rejects video without audio', () => {
  assert.throws(() => parseProbe({
    format,
    streams: [{
      index: 0, codec_type: 'video', codec_name: 'h264', width: 1280, height: 720,
      avg_frame_rate: '30/1', r_frame_rate: '30/1',
    }],
  }), /Video input must contain an audio stream/);
});

type RunResult = { readonly stdout: string; readonly stderr: string };

function preflightDeps(options: {
  readonly exists?: Readonly<Record<string, boolean>>;
  readonly filters?: string;
  readonly chromium?: boolean;
} = {}) {
  const exists = options.exists ?? { ffmpeg: true, ffprobe: true };
  return {
    commandExistsFn: async (command: string) => exists[command] ?? false,
    runProcessFn: async (command: string, args: readonly string[]): Promise<RunResult> => ({
      stdout: args[0] === '-filters' ? (options.filters ?? ' ... subtitles ... ') : `${command} version 1`,
      stderr: '',
    }),
    checkChromium: async () => options.chromium ?? true,
  };
}

test('preflight rejects Node 19', async () => {
  await assert.rejects(
    preflight({ mode: 'video', nodeVersion: '19.9.0', ...preflightDeps() }),
    /Node\.js 20 or newer is required/,
  );
});

test('preflight reports missing FFmpeg', async () => {
  await assert.rejects(
    preflight({
      mode: 'video', nodeVersion: '20.0.0',
      ...preflightDeps({ exists: { ffmpeg: false, ffprobe: true } }),
    }),
    /FFmpeg executable not found: ffmpeg/,
  );
});

test('preflight reports missing FFprobe', async () => {
  await assert.rejects(
    preflight({
      mode: 'video', nodeVersion: '20.0.0',
      ...preflightDeps({ exists: { ffmpeg: true, ffprobe: false } }),
    }),
    /FFprobe executable not found: ffprobe/,
  );
});

test('preflight requires subtitles filter only for MP3 mode', async () => {
  const deps = preflightDeps({ filters: 'scale overlay', chromium: true });
  await assert.rejects(
    preflight({ mode: 'mp3', nodeVersion: '20.0.0', ...deps }),
    /FFmpeg subtitles filter is required/,
  );
  await preflight({ mode: 'video', nodeVersion: '20.0.0', ...deps });
});

test('preflight gives the exact Chromium installation command', async () => {
  await assert.rejects(
    preflight({
      mode: 'video', nodeVersion: '20.0.0',
      ...preflightDeps({ chromium: false }),
    }),
    /Playwright Chromium is not installed\. Run: npx playwright install chromium/,
  );
});
