import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBuildArgs } from '../src/build/cli-options.ts';

test('parseBuildArgs preserves automatic subtitle behavior by default', () => {
  assert.deepEqual(parseBuildArgs(['build', 'song.mp3']), {
    inputPath: 'song.mp3', subtitle: undefined,
  });
});

test('parseBuildArgs supports explicit and disabled subtitles', () => {
  assert.deepEqual(parseBuildArgs(['build', 'clip.mp4', '--subtitle', 'lyrics.srt']), {
    inputPath: 'clip.mp4', subtitle: 'lyrics.srt',
  });
  assert.deepEqual(parseBuildArgs(['build', 'song.mp3', '--no-subtitle']), {
    inputPath: 'song.mp3', subtitle: null,
  });
});

for (const args of [
  [],
  ['render', 'song.mp3'],
  ['build', 'song.mp3', '--subtitle'],
  ['build', 'song.mp3', '--unknown'],
  ['build', 'song.mp3', '--no-subtitle', '--subtitle', 'lyrics.lrc'],
]) {
  test(`parseBuildArgs rejects invalid arguments: ${args.join(' ')}`, () => {
    assert.throws(() => parseBuildArgs(args), /Usage:/);
  });
}
