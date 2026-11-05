import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildPagesApp } from '../src/play/build-pages.ts';
import { buildPagesData } from '../src/play/pages-data.ts';

const sourcePlaylistUrl = 'https://github.com/owner/repo/releases/download/game-data/playlist.json';

test('Pages data keeps video on Release and copies validated chart beside playlist', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'music-game-pages-data-'));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const requested: string[] = [];

  const result = await buildPagesData({
    outputDirectory,
    playlistUrl: sourcePlaylistUrl,
    fetchJson: async (url) => {
      requested.push(url);
      if (url === sourcePlaylistUrl) {
        return {
          formatVersion: 1,
          version: 'release-v1',
          songs: [{
            id: 'HERE × HEAR', title: 'HERE × HEAR',
            background: 'HERE × HEAR/background.mp4',
            chart: 'HERE × HEAR/chart.json',
          }],
        };
      }
      return {
        formatVersion: 1, audio: 'HERE × HEAR.mp3', duration: 10,
        bpm: 120, beatOffset: 0, beatsPerBar: 4, difficulty: 'normal',
        lanes: 4, seed: 1,
        notes: [{ type: 'tap', time: 1, lane: 0 }], statistics: {},
      };
    },
  });

  const playlist = JSON.parse(await readFile(result.playlistPath, 'utf8')) as {
    songs: Array<{ background: string; chart: string }>;
  };
  assert.deepEqual(playlist.songs[0], {
    id: 'HERE × HEAR',
    title: 'HERE × HEAR',
    background: 'https://github.com/owner/repo/releases/download/game-data/HERE_u20__ud7__u20_HEAR__background.mp4?v=release-v1',
    chart: 'chart-0.json',
  });
  assert.equal(JSON.parse(await readFile(
    join(outputDirectory, 'chart-0.json'), 'utf8',
  )).audio, 'HERE × HEAR.mp3');
  assert.deepEqual(requested, [
    sourcePlaylistUrl,
    'https://github.com/owner/repo/releases/download/game-data/HERE_u20__ud7__u20_HEAR__chart.json?v=release-v1',
  ]);
});

test('Pages data rejects an invalid downloaded chart', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'music-game-pages-invalid-'));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  let calls = 0;

  await assert.rejects(() => buildPagesData({
    outputDirectory,
    playlistUrl: sourcePlaylistUrl,
    fetchJson: async () => {
      calls += 1;
      return calls === 1 ? {
        formatVersion: 1, version: 'v1',
        songs: [{ id: 'bad', title: 'Bad', background: 'bad/background.mp4', chart: 'bad/chart.json' }],
      } : { formatVersion: 2 };
    },
  }), /formatVersion/);
});

test('Pages build emits the game bundle and static data together', async (t) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'music-game-pages-build-'));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  let calls = 0;

  await buildPagesApp({
    outputDirectory,
    playlistUrl: sourcePlaylistUrl,
    fetchJson: async () => {
      calls += 1;
      return calls === 1 ? {
        formatVersion: 1, version: 'v1',
        songs: [{ id: 'song', title: 'Song', background: 'song/background.mp4', chart: 'song/chart.json' }],
      } : {
        formatVersion: 1, audio: 'song.mp3', duration: 10,
        bpm: 120, beatOffset: 0, beatsPerBar: 4, difficulty: 'normal',
        lanes: 4, seed: 1, notes: [{ type: 'tap', time: 1, lane: 0 }], statistics: {},
      };
    },
  });

  assert.match(await readFile(join(outputDirectory, 'index.html'), 'utf8'), /play\.js/);
  assert.equal(JSON.parse(await readFile(
    join(outputDirectory, 'data', 'playlist.json'), 'utf8',
  )).songs.length, 1);
  assert.equal(await readFile(join(outputDirectory, '.nojekyll'), 'utf8'), '');
});
