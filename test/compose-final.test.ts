import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildFinalArgs, composeFinal } from '../src/video/compose-final.ts';
import type { ProbeMetadata } from '../src/media/probe.ts';
import { probeMedia } from '../src/media/probe.ts';
import { runProcess } from '../src/platform/process.ts';

const backgroundMedia: ProbeMetadata = {
  durationSec: 5,
  video: {
    index: 0, codec: 'h264', pixelFormat: 'yuv420p',
    encodedWidth: 320, encodedHeight: 180,
    displayWidth: 320, displayHeight: 180, rotationDeg: 0,
    avgFps: 30, isVfr: false, startSec: 0, durationSec: 5,
  },
  audio: {
    index: 1, codec: 'aac', sampleRate: 48000, channels: 2,
    startSec: 0, durationSec: 5,
  },
};

test('buildFinalArgs overlays the game video and preserves background audio', () => {
  const args = buildFinalArgs({
    backgroundPath: '/work/background.mp4',
    overlayPath: '/work/overlay.mov',
    outputPath: '/work/final.tmp.mp4',
    durationSec: 5,
  });

  assert.deepEqual(args.slice(0, 8), [
    '-hide_banner', '-stats', '-loglevel', 'warning',
    '-i', '/work/background.mp4', '-i', '/work/overlay.mov',
  ]);
  assert.match(args[args.indexOf('-filter_complex') + 1]!, /\[0:v:0\]\[1:v:0\]overlay=0:0/);
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), [
    '-map', '[v]', '-map', '0:a:0',
  ]);
  for (const expected of ['libx264', '30', 'yuv420p', '+faststart', '5']) {
    assert(args.includes(expected), `missing ${expected}`);
  }
  assert.equal(args[args.indexOf('-preset') + 1], 'veryfast');
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'copy']);
});

test('composeFinal reports the measured conversion time after validated output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'compose-final-unit-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const outputPath = join(root, 'final.mp4');
  const times = [1_000, 2_875];

  const result = await composeFinal({
    backgroundPath: join(root, 'background.mp4'),
    overlayPath: join(root, 'overlay.mov'),
    backgroundMedia,
    outputPath,
    logPath: join(root, 'build.log'),
    now: () => times.shift()!,
    runProcessFn: async (_command, args) => {
      await writeFile(args.at(-1)!, 'encoded');
      return { stdout: '', stderr: '' };
    },
    probeMediaFn: async () => backgroundMedia,
  });

  assert.equal(result.path, outputPath);
  assert.equal(result.elapsedMs, 1_875);
  assert.equal(await readFile(outputPath, 'utf8'), 'encoded');
  await assert.rejects(readFile(join(root, 'final.tmp.mp4')), { code: 'ENOENT' });
});

test('composeFinal creates a real H.264/AAC video from an alpha overlay', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'compose-final-integration-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const backgroundPath = join(root, 'background.mp4');
  const overlayPath = join(root, 'overlay.mov');
  const outputPath = join(root, 'final.mp4');
  await runProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', backgroundPath,
  ]);
  await runProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black@0.0:s=320x180:r=30:d=1,format=rgba,drawbox=x=100:y=50:w=100:h=80:color=green@1:t=fill',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-y', overlayPath,
  ]);
  const source = await probeMedia(backgroundPath);

  const result = await composeFinal({
    backgroundPath, overlayPath, backgroundMedia: source, outputPath,
    logPath: join(root, 'build.log'),
  });

  assert.equal(result.media.video?.codec, 'h264');
  assert.equal(result.media.audio?.codec, 'aac');
  assert.equal(result.media.video?.displayWidth, 320);
  assert.equal(result.media.video?.displayHeight, 180);
  assert.equal(result.media.video?.avgFps, 30);
  assert.equal(result.media.video?.isVfr, false);
  assert(result.elapsedMs > 0);
});
