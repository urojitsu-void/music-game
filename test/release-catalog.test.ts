import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chart } from '../src/chart/schema.ts';
import {
  flattenReleaseAssetPath,
  loadReleaseCatalog,
  loadReleaseSong,
  releaseAssetUrl,
} from '../src/play/release-catalog.ts';

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

test('release catalog keeps relative data paths and rejects unsafe paths', () => {
  assert.equal(flattenReleaseAssetPath('dear-who/background.mp4'), 'dear-who__background.mp4');
  assert.equal(
    flattenReleaseAssetPath('HERE × HEAR/background.mp4'),
    'HERE_u20__ud7__u20_HEAR__background.mp4',
  );
  assert.equal(flattenReleaseAssetPath('楽曲/chart.json'), '_u697d__u66f2___chart.json');
  assert.throws(() => flattenReleaseAssetPath('../secret.mp4'), /relative data path/);
  assert.throws(() => flattenReleaseAssetPath('/absolute.mp4'), /relative data path/);
  assert.throws(() => flattenReleaseAssetPath('song__bad/chart.json'), /double underscore/);
});

test('release asset URL resolves flattened paths beside playlist.json', () => {
  assert.equal(
    releaseAssetUrl(
      'https://github.com/owner/repo/releases/download/game-data/playlist.json',
      'dear-who/background.mp4',
      '2026-11-05T00:00:00.000Z',
    ),
    'https://github.com/owner/repo/releases/download/game-data/dear-who__background.mp4?v=2026-11-05T00%3A00%3A00.000Z',
  );
  assert.equal(
    releaseAssetUrl('/api/release/playlist.json', 'song/chart.json', 'v1'),
    '/api/release/song__chart.json?v=v1',
  );
});

test('release catalog loads playlist metadata without fetching every chart', async () => {
  const requested: string[] = [];
  const catalog = await loadReleaseCatalog(
    'https://github.com/owner/repo/releases/download/game-data/playlist.json',
    async (url) => {
      requested.push(url);
      return {
        formatVersion: 1,
        version: 'v1',
        songs: [{
          id: 'dear-who',
          title: 'DEAR, WHO?',
          artist: 'artist',
          background: 'dear-who/background.mp4',
          chart: 'dear-who/chart.json',
          thumbnail: 'dear-who/thumbnail.jpg',
        }],
      };
    },
  );

  assert.equal(catalog.songs[0]?.title, 'DEAR, WHO?');
  assert.match(catalog.songs[0]?.thumbnailUrl ?? '', /dear-who__thumbnail\.jpg/);
  assert.deepEqual(requested, [
    'https://github.com/owner/repo/releases/download/game-data/playlist.json',
  ]);
});

test('release song fetches and validates its chart only when selected', async () => {
  const playlistUrl = 'https://github.com/owner/repo/releases/download/game-data/playlist.json';
  const catalog = await loadReleaseCatalog(playlistUrl, async () => ({
    formatVersion: 1,
    version: 'v2',
    songs: [{
      id: 'song', title: 'Song', background: 'song/background.mp4', chart: 'song/chart.json',
    }],
  }));
  const requested: string[] = [];

  const song = await loadReleaseSong(catalog, catalog.songs[0]!, async (url) => {
    requested.push(url);
    return chart();
  });

  assert.deepEqual(requested, [
    'https://github.com/owner/repo/releases/download/game-data/song__chart.json?v=v2',
  ]);
  assert.equal(song.backgroundVideoUrl,
    'https://github.com/owner/repo/releases/download/game-data/song__background.mp4?v=v2');
  assert.deepEqual(song.chart, chart());
});

test('release catalog rejects duplicate IDs and duplicate flattened asset names', async () => {
  await assert.rejects(() => loadReleaseCatalog('https://example.com/playlist.json', async () => ({
    formatVersion: 1,
    version: 'v1',
    songs: [
      { id: 'same', title: 'One', background: 'one/video.mp4', chart: 'one/chart.json' },
      { id: 'same', title: 'Two', background: 'two/video.mp4', chart: 'two/chart.json' },
    ],
  })), /duplicate song id/);
});
