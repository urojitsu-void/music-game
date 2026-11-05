import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { Chart } from '../src/chart/schema.ts';
import { startPlayServer, type RunningPlayServer } from '../src/play/server.ts';

function chart(): Chart {
  return {
    formatVersion: 1,
    audio: 'song.mp3',
    duration: 10,
    bpm: 120,
    beatOffset: 0,
    beatsPerBar: 4,
    difficulty: 'normal',
    lanes: 4,
    seed: 1,
    notes: [{ type: 'tap', time: 1, lane: 0 }],
    statistics: {},
  };
}

async function fixture(t: test.TestContext): Promise<{
  readonly root: string;
  readonly output: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'play-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'public');
  const output = join(directory, 'output');
  await Promise.all([mkdir(root), mkdir(output)]);
  await Promise.all([
    writeFile(join(root, 'index.html'), '<h1>Music Game</h1>'),
    writeFile(join(root, 'play.js'), 'globalThis.PLAY = true;'),
    writeFile(join(root, 'background.mp4'), Buffer.from('0123456789')),
  ]);
  return { root, output };
}

async function running(
  t: test.TestContext,
  options: Parameters<typeof startPlayServer>[0],
): Promise<RunningPlayServer> {
  const server = await startPlayServer({ ...options, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  return server;
}

test('play server serves index and static files with content types', async (t) => {
  const paths = await fixture(t);
  const server = await running(t, { root: paths.root, outputDirectory: paths.output, debug: false });

  const [index, script, missing] = await Promise.all([
    fetch(`${server.url}/`),
    fetch(`${server.url}/play.js`),
    fetch(`${server.url}/missing.js`),
  ]);

  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await index.text(), /Music Game/);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
  assert.equal(missing.status, 404);
});

test('play server rejects encoded path traversal', async (t) => {
  const paths = await fixture(t);
  const secret = join(paths.root, '..', 'secret.txt');
  await writeFile(secret, 'secret');
  const server = await running(t, { root: paths.root, outputDirectory: paths.output, debug: false });

  const response = await fetch(`${server.url}/..%2Fsecret.txt`);

  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /secret/);
});

test('play server supports byte ranges for background video', async (t) => {
  const paths = await fixture(t);
  const server = await running(t, { root: paths.root, outputDirectory: paths.output, debug: false });

  const response = await fetch(`${server.url}/background.mp4`, {
    headers: { Range: 'bytes=2-5' },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), '2345');
});

test('play server proxies Release playlist and ranged assets through the same origin', async (t) => {
  const paths = await fixture(t);
  const requested: Array<{ url: string; range: string | null }> = [];
  const server = await running(t, {
    root: paths.root,
    outputDirectory: paths.output,
    debug: false,
    playlistUrl: 'https://data.example/releases/game-data/playlist.json',
    releaseFetch: async (url, init) => {
      requested.push({
        url,
        range: new Headers(init?.headers).get('range'),
      });
      if (url.endsWith('/playlist.json')) {
        return new Response('{"formatVersion":1,"version":"v1","songs":[]}', {
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
      return new Response('2345', {
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '4',
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes 2-5/10',
        },
      });
    },
  });

  const runtime = await fetch(`${server.url}/api/runtime`).then((response) => response.json());
  const playlist = await fetch(`${server.url}/api/release/playlist.json`);
  const video = await fetch(`${server.url}/api/release/song__background.mp4`, {
    headers: { Range: 'bytes=2-5' },
  });

  assert.deepEqual(runtime, { debug: false, playlistUrl: '/api/release/playlist.json' });
  assert.match(playlist.headers.get('content-type') ?? '', /json/);
  assert.equal(video.status, 206);
  assert.equal(video.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await video.text(), '2345');
  assert.deepEqual(requested, [
    { url: 'https://data.example/releases/game-data/playlist.json', range: null },
    { url: 'https://data.example/releases/game-data/song__background.mp4', range: 'bytes=2-5' },
  ]);
});

test('normal play server hides all debug endpoints', async (t) => {
  const paths = await fixture(t);
  const server = await running(t, { root: paths.root, outputDirectory: paths.output, debug: false });

  const [output, generation, runtime] = await Promise.all([
    fetch(`${server.url}/api/debug/output`),
    fetch(`${server.url}/api/debug/generate`, { method: 'POST' }),
    fetch(`${server.url}/api/runtime`),
  ]);

  assert.equal(output.status, 404);
  assert.equal(generation.status, 404);
  assert.deepEqual(await runtime.json(), {
    debug: false,
    playlistUrl: '/api/release/playlist.json',
  });
});

test('debug play server validates and exposes output plus detailed status', async (t) => {
  const paths = await fixture(t);
  await Promise.all([
    writeFile(join(paths.output, 'background.mp4'), Buffer.from('debug-video')),
    writeFile(join(paths.output, 'chart.json'), JSON.stringify(chart())),
  ]);
  const server = await running(t, { root: paths.root, outputDirectory: paths.output, debug: true });

  const [output, background, status, generation, runtime] = await Promise.all([
    fetch(`${server.url}/api/debug/output`),
    fetch(`${server.url}/api/debug/output/background.mp4`),
    fetch(`${server.url}/api/debug/status`),
    fetch(`${server.url}/api/debug/generate`, { method: 'POST' }),
    fetch(`${server.url}/api/runtime`),
  ]);

  assert.equal(output.status, 200);
  assert.deepEqual(await output.json(), {
    id: 'debug-output',
    title: 'output',
    backgroundVideoUrl: '/api/debug/output/background.mp4',
    chart: chart(),
  });
  assert.equal(await background.text(), 'debug-video');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    debug: true,
    outputDirectory: paths.output,
    generation: 'not-implemented',
  });
  assert.equal(generation.status, 501);
  assert.deepEqual(await runtime.json(), {
    debug: true,
    playlistUrl: '/api/release/playlist.json',
  });
});

test('debug output reports a validation failure without exposing it in normal mode', async (t) => {
  const paths = await fixture(t);
  await Promise.all([
    writeFile(join(paths.output, 'background.mp4'), Buffer.from('debug-video')),
    writeFile(join(paths.output, 'chart.json'), '{"formatVersion":2}'),
  ]);
  const server = await running(t, { root: paths.root, outputDirectory: paths.output, debug: true });

  const response = await fetch(`${server.url}/api/debug/output`);

  assert.equal(response.status, 422);
  assert.match((await response.json() as { error: string }).error, /formatVersion/);
});
