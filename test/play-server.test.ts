import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startPlayServer, type RunningPlayServer } from '../src/play/server.ts';

async function fixture(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'play-server-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'public');
  await mkdir(join(root, 'data'), { recursive: true });
  await Promise.all([
    writeFile(join(root, 'index.html'), '<h1>Music Game</h1>'),
    writeFile(join(root, 'play.js'), 'globalThis.PLAY = true;'),
    writeFile(join(root, 'background.mp4'), Buffer.from('0123456789')),
    writeFile(join(root, 'data', 'playlist.json'), '{"formatVersion":1,"songs":[]}'),
  ]);
  return root;
}

async function running(t: test.TestContext, root: string): Promise<RunningPlayServer> {
  const server = await startPlayServer({ root, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  return server;
}

test('play server serves the same static game and data files as Pages', async (t) => {
  const root = await fixture(t);
  const server = await running(t, root);

  const [index, script, playlist, runtime] = await Promise.all([
    fetch(`${server.url}/`),
    fetch(`${server.url}/play.js`),
    fetch(`${server.url}/data/playlist.json`),
    fetch(`${server.url}/api/runtime`),
  ]);

  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await index.text(), /Music Game/);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
  assert.match(playlist.headers.get('content-type') ?? '', /json/);
  assert.equal(runtime.status, 404);
});

test('play server rejects encoded path traversal', async (t) => {
  const root = await fixture(t);
  const secret = join(root, '..', 'secret.txt');
  await writeFile(secret, 'secret');
  const server = await running(t, root);

  const response = await fetch(`${server.url}/..%2Fsecret.txt`);

  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /secret/);
});

test('play server supports byte ranges for static media', async (t) => {
  const root = await fixture(t);
  const server = await running(t, root);

  const response = await fetch(`${server.url}/background.mp4`, {
    headers: { Range: 'bytes=2-5' },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), '2345');
});
