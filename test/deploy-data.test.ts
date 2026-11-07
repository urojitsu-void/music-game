import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  deployPreparedData, prepareDataDeployment, type DataReleaseConfig,
} from '../src/play/deploy-data.ts';

const release: DataReleaseConfig = {
  repository: 'owner/repo',
  tag: 'game-data',
};

function chart(audio = 'Test Song.mp3'): string {
  return JSON.stringify({
    formatVersion: 1, audio, duration: 10, bpm: 120, beatOffset: 0,
    beatsPerBar: 4, difficulty: 'normal', lanes: 4, seed: 1,
    notes: [{ type: 'tap', time: 1, lane: 0 }], statistics: {},
  });
}

test('data deployment recursively stages referenced data with flattened asset names', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'game-data-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dear-who'));
  await Promise.all([
    writeFile(join(root, 'dear-who', 'background.mp4'), 'video'),
    writeFile(join(root, 'dear-who', 'chart.json'), chart()),
  ]);

  const deployment = await prepareDataDeployment({
    dataDirectory: root,
    release,
    now: new Date('2026-11-05T00:00:00.000Z'),
    createThumbnail: async (backgroundPath, thumbnailPath) => {
      assert.equal(backgroundPath, join(root, 'dear-who', 'background.mp4'));
      assert.equal(thumbnailPath, join(root, 'dear-who', 'thumbnail.jpg'));
      await writeFile(thumbnailPath, 'image');
    },
  });
  t.after(() => deployment.cleanup());

  assert.deepEqual(deployment.assets.map((asset) => asset.name).sort(), [
    'dear-who__background.mp4',
    'dear-who__chart.json',
    'dear-who__thumbnail.jpg',
    'playlist.json',
  ]);
  const publicPlaylist = JSON.parse(await readFile(
    deployment.assets.find((asset) => asset.name === 'playlist.json')!.path,
    'utf8',
  )) as { version: string; songs: Array<Record<string, unknown>> };
  assert.equal(publicPlaylist.version, '2026-11-05T00:00:00.000Z');
  assert.equal(publicPlaylist.songs.length, 1);
  assert.deepEqual(publicPlaylist.songs[0], {
    id: 'dear-who',
    title: 'Test Song',
    background: 'dear-who/background.mp4',
    chart: 'dear-who/chart.json',
    thumbnail: 'dear-who/thumbnail.jpg',
  });
  const localPlaylist = JSON.parse(await readFile(join(root, 'playlist.json'), 'utf8')) as {
    songs: unknown[];
  };
  assert.deepEqual(localPlaylist.songs, publicPlaylist.songs);
  assert.equal(deployment.playlistUrl,
    'https://github.com/owner/repo/releases/download/game-data/playlist.json');
});

test('data deployment fails before upload when a song directory lacks its background', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'game-data-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'missing'));
  await writeFile(join(root, 'missing', 'chart.json'), chart('Missing.mp3'));

  await assert.rejects(() => prepareDataDeployment({
    dataDirectory: root, release, now: new Date(0),
  }), /missing\/background\.mp4/);
});

test('data deployment rejects an invalid chart while generating playlist', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'game-data-invalid-chart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'broken'));
  await Promise.all([
    writeFile(join(root, 'broken', 'background.mp4'), 'video'),
    writeFile(join(root, 'broken', 'chart.json'), '{"formatVersion":2}'),
  ]);

  await assert.rejects(() => prepareDataDeployment({
    dataDirectory: root, release, now: new Date(0),
  }), /formatVersion/);
});

test('data deployment dry-run reports commands without invoking gh', async () => {
  const calls: unknown[] = [];
  const prepared = {
    release,
    playlistUrl: 'https://example.com/playlist.json',
    assets: [
      { name: 'song__chart.json', path: '/tmp/staged/song__chart.json', sourcePath: 'song/chart.json' },
      { name: 'playlist.json', path: '/tmp/staged/playlist.json', sourcePath: null },
    ],
    cleanup: async () => undefined,
  };

  const result = await deployPreparedData(prepared, {
    dryRun: true,
    run: async (...args) => { calls.push(args); return { exitCode: 0, stderr: '' }; },
  });

  assert.deepEqual(calls, []);
  assert.equal(result.uploaded, false);
  assert.match(result.summary.join('\n'), /song__chart\.json/);
});

test('data deployment creates a missing release then uploads all staged assets', async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const prepared = {
    release,
    playlistUrl: 'https://example.com/playlist.json',
    assets: [
      { name: 'song__chart.json', path: '/tmp/staged/song__chart.json', sourcePath: 'song/chart.json' },
      { name: 'playlist.json', path: '/tmp/staged/playlist.json', sourcePath: null },
    ],
    cleanup: async () => undefined,
  };

  const result = await deployPreparedData(prepared, {
    dryRun: false,
    run: async (command, args) => {
      calls.push({ command, args });
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: '' };
    },
  });

  assert.equal(result.uploaded, true);
  assert.deepEqual(calls, [
    { command: 'gh', args: [
      'release', 'view', 'game-data', '--repo', 'owner/repo', '--json', 'assets',
    ] },
    { command: 'gh', args: [
      'release', 'create', 'game-data', '--repo', 'owner/repo',
      '--title', 'Game Data', '--notes', 'Music game data assets', '--latest=false',
    ] },
    { command: 'gh', args: [
      'release', 'upload', 'game-data',
      '/tmp/staged/song__chart.json', '/tmp/staged/playlist.json',
      '--repo', 'owner/repo', '--clobber',
    ] },
    { command: 'gh', args: [
      'workflow', 'run', 'pages.yml', '--repo', 'owner/repo', '--ref', 'main',
    ] },
  ]);
});

test('data deployment deletes release assets that are absent from data', async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const prepared = {
    release,
    playlistUrl: 'https://example.com/playlist.json',
    assets: [
      { name: 'song__chart.json', path: '/tmp/staged/song__chart.json', sourcePath: 'song/chart.json' },
      { name: 'playlist.json', path: '/tmp/staged/playlist.json', sourcePath: null },
    ],
    cleanup: async () => undefined,
  };

  await deployPreparedData(prepared, {
    dryRun: false,
    run: async (command, args) => {
      calls.push({ command, args });
      return calls.length === 1
        ? { exitCode: 0, stderr: '', stdout: JSON.stringify({
          assets: [{ name: 'old__background.mp4' }, { name: 'playlist.json' }],
        }) }
        : { exitCode: 0, stderr: '', stdout: '' };
    },
  });

  assert.deepEqual(calls[1], {
    command: 'gh',
    args: [
      'release', 'delete-asset', 'game-data', 'old__background.mp4',
      '--repo', 'owner/repo', '--yes',
    ],
  });
});
