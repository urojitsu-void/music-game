import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildMp3BackgroundArgs,
  buildVideoBackgroundArgs,
  createBackground,
} from '../src/media/background.ts';
import { ProcessExecutionError } from '../src/platform/process.ts';
import type { ProbeMetadata } from '../src/media/probe.ts';
import { createVideoWithShortAudio } from './helpers/create-fixtures.ts';

test('buildMp3BackgroundArgs preserves the reference spectrum composition', () => {
  const args = buildMp3BackgroundArgs({
    coverPath: '/media/cover.png', audioPath: '/media/song.mp3',
    subtitlePath: '/media/song.lrc', outputPath: '/out/background.tmp.mp4',
  });
  const graph = args[args.indexOf('-filter_complex') + 1]!;

  assert.match(graph, /scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720/);
  assert.match(graph, /showfreqs=s=1280x200:mode=bar:ascale=sqrt:fscale=log:colors=white:rate=30/);
  assert.equal((graph.match(/colorchannelmixer=/g) ?? []).length, 7);
  assert.match(graph, /subtitles=filename='\/media\/song\.lrc':force_style='FontSize=22,Outline=2,Shadow=1,MarginV=45'/);
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), ['-map', '[v]', '-map', '1:a:0']);
  for (const expected of ['libx264', 'aac', '30', 'yuv420p', '+faststart', '-shortest']) {
    assert(args.includes(expected), `missing ${expected}`);
  }
});

test('buildMp3BackgroundArgs omits the subtitle filter when disabled', () => {
  const args = buildMp3BackgroundArgs({
    coverPath: '/media/cover.png', audioPath: '/media/song.mp3',
    subtitlePath: null, outputPath: '/out/background.tmp.mp4',
  });
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.doesNotMatch(graph, /subtitles=/);
  assert.match(graph, /\[o5\]\[c6\]overlay=1098:H-h,format=yuv420p\[v\]$/);
});

test('buildVideoBackgroundArgs normalizes the first selected streams', () => {
  const args = buildVideoBackgroundArgs({
    inputPath: '/media/input.mov', outputPath: '/out/background.tmp.mp4',
    media: {
      durationSec: 5,
      video: {
        index: 2, codec: 'hevc', encodedWidth: 1080, encodedHeight: 1920,
        displayWidth: 1920, displayHeight: 1080, rotationDeg: 90,
        avgFps: 24, isVfr: true, startSec: 1, durationSec: 5,
      },
      audio: {
        index: 4, codec: 'aac', sampleRate: 48000, channels: 2,
        startSec: 0.5, durationSec: 3,
      },
    },
  });
  const graph = args[args.indexOf('-filter_complex') + 1]!;

  assert.match(graph, /\[0:2\]setpts=PTS-STARTPTS,fps=30,scale=1920:1080/);
  assert.match(graph, /\[0:4\]asetpts=PTS-STARTPTS,apad,atrim=duration=5/);
  assert(args.includes('-fps_mode') && args.includes('cfr'));
  assert.deepEqual(args.slice(args.indexOf('-metadata:s:v:0'), args.indexOf('-metadata:s:v:0') + 2), ['-metadata:s:v:0', 'rotate=0']);
  assert(args.includes('libx264') && args.includes('aac'));
});

test('buildVideoBackgroundArgs burns an explicitly selected subtitle', () => {
  const args = buildVideoBackgroundArgs({
    inputPath: '/media/input.mp4', subtitlePath: '/media/lyrics.srt',
    outputPath: '/out/background.tmp.mp4',
    media: {
      durationSec: 5,
      video: {
        index: 0, codec: 'h264', encodedWidth: 1280, encodedHeight: 720,
        displayWidth: 1280, displayHeight: 720, rotationDeg: 0,
        avgFps: 30, isVfr: false, startSec: 0, durationSec: 5,
      },
      audio: {
        index: 1, codec: 'aac', sampleRate: 48000, channels: 2,
        startSec: 0, durationSec: 5,
      },
    },
  });
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.match(graph, /subtitles=filename='\/media\/lyrics\.srt'/);
});

test('createBackground passes LRC directly and writes a complete atomic error log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'background-unit-'));
  const audioPath = join(root, 'song.mp3');
  const lrcPath = join(root, 'song.lrc');
  const coverPath = join(root, 'song.png');
  const outputPath = join(root, 'background.mp4');
  const logPath = join(root, 'build.log');
  await Promise.all([
    writeFile(audioPath, 'audio'),
    writeFile(lrcPath, '[00:00.00]hello'),
    writeFile(coverPath, 'image'),
  ]);
  const audioProbe: ProbeMetadata = {
    durationSec: 5, video: null,
    audio: { index: 0, codec: 'mp3', sampleRate: 44100, channels: 2, startSec: 0, durationSec: 5 },
  };
  let subtitlePath = '';
  const failure = new ProcessExecutionError('ffmpeg-custom', 9, 'complete stderr');

  await assert.rejects(createBackground({
    inputs: { mode: 'mp3', audioPath, subtitlePath: lrcPath, coverPath },
    outputPath, logPath,
    ffmpegPath: 'ffmpeg-custom', ffprobePath: 'ffprobe-custom',
    probeMediaFn: async () => audioProbe,
    runProcessFn: async (_command, args) => {
      subtitlePath = args[args.indexOf('-filter_complex') + 1]!.match(/filename='([^']+)'/)![1]!;
      throw failure;
    },
  }), (error: unknown) => error === failure);

  assert.equal(subtitlePath, lrcPath);
  assert.equal(await readFile(lrcPath, 'utf8'), '[00:00.00]hello');
  const log = await readFile(logPath, 'utf8');
  assert.match(log, /"stage": "background"/);
  assert.match(log, /"command": "ffmpeg-custom"/);
  assert.match(log, /"code": 9/);
  assert.match(log, /"stderr": "complete stderr"/);
  assert.match(log, /"arguments": \[/);
  await assert.rejects(readFile(`${logPath}.tmp`), { code: 'ENOENT' });
});

test('createBackground ignores embedded MP3 cover dimensions when validating output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'background-mp3-cover-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const outputPath = join(root, 'background.mp4');
  const source: ProbeMetadata = {
    durationSec: 5,
    video: {
      index: 0, codec: 'mjpeg', encodedWidth: 1400, encodedHeight: 1400,
      displayWidth: 1400, displayHeight: 1400, rotationDeg: 0,
      avgFps: 0, isVfr: false, startSec: 0, durationSec: 5,
    },
    audio: { index: 1, codec: 'mp3', sampleRate: 44100, channels: 2, startSec: 0, durationSec: 5 },
  };
  const output: ProbeMetadata = {
    durationSec: 5,
    video: {
      index: 0, codec: 'h264', encodedWidth: 1280, encodedHeight: 720,
      displayWidth: 1280, displayHeight: 720, rotationDeg: 0,
      avgFps: 30, isVfr: false, startSec: 0, durationSec: 5,
    },
    audio: { index: 1, codec: 'aac', sampleRate: 44100, channels: 2, startSec: 0, durationSec: 5 },
  };
  let probes = 0;

  const result = await createBackground({
    inputs: {
      mode: 'mp3', audioPath: join(root, 'song.mp3'),
      subtitlePath: join(root, 'song.lrc'), coverPath: join(root, 'song.png'),
    },
    outputPath, logPath: join(root, 'build.log'),
    runProcessFn: async (_command, args) => {
      await writeFile(args.at(-1)!, 'encoded');
      return { stdout: '', stderr: '' };
    },
    probeMediaFn: async () => (probes++ === 0 ? source : output),
  });

  assert.equal(result.media.video?.displayWidth, 1280);
  assert.equal(result.media.video?.displayHeight, 720);
});

test('createBackground normalizes video to 30fps and pads short audio', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'background-integration-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const inputPath = join(root, 'short-audio.mp4');
  const outputPath = join(root, 'background.mp4');
  await createVideoWithShortAudio(inputPath);

  const result = await createBackground({
    inputs: { mode: 'video', videoPath: inputPath, subtitlePath: null },
    outputPath,
    logPath: join(root, 'build.log'),
  });

  assert.equal(result.path, outputPath);
  assert.equal(result.media.video?.codec, 'h264');
  assert.equal(result.media.audio?.codec, 'aac');
  assert.equal(result.media.video?.displayWidth, 320);
  assert.equal(result.media.video?.displayHeight, 180);
  assert.equal(result.media.video?.avgFps, 30);
  assert.equal(result.media.video?.isVfr, false);
  assert(Math.abs(result.media.durationSec - 5) <= 1 / 30 + 0.001);
  assert(Math.abs((result.media.audio?.durationSec ?? 0) - 5) <= 1 / 30 + 0.001);
  await assert.rejects(readFile(join(root, 'background.tmp.mp4')), { code: 'ENOENT' });
});
