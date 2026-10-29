import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test, type TestContext } from 'node:test';

import { resolveInputs, type ResolvedInputs } from '../src/build/inputs.ts';

// Type-only checks: keep the discriminant and all resolved paths immutable.
function checkResolvedInputTypes(input: ResolvedInputs): string {
  if (input.mode === 'mp3') {
    // @ts-expect-error Resolved audio paths are readonly.
    input.audioPath = 'other.mp3';
    // @ts-expect-error MP3 inputs have no video path.
    input.videoPath;
    return input.audioPath;
  }
  // @ts-expect-error Resolved video paths are readonly.
  input.videoPath = 'other.mp4';
  // @ts-expect-error Video inputs have no audio path.
  input.audioPath;
  return input.videoPath;
}

async function fixture(t: TestContext, names: readonly string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'music-inputs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of names) await writeFile(join(dir, name), 'fixture');
  return dir;
}

for (const imageExt of ['png', 'jpg', 'jpeg', 'PnG', 'JPG', 'JpEg']) {
  test(`resolves MP3/LRC and ${imageExt} case-insensitively with Unicode and spaces`, async (t) => {
    const base = 'HERE × HEAR 日本語';
    const dir = await fixture(t, [`${base}.Mp3`, `${base}.LrC`, `${base}.${imageExt}`, 'other.png']);
    const actual = await resolveInputs({ inputPath: join(dir, `${base}.Mp3`) });
    assert.deepEqual(actual, {
      mode: 'mp3', audioPath: join(dir, `${base}.Mp3`),
      lrcPath: join(dir, `${base}.LrC`), coverPath: join(dir, `${base}.${imageExt}`),
    });
    assert.equal(Object.getPrototypeOf(actual), Object.prototype);
    assert.equal(Object.isFrozen(actual), true);
    assert.throws(() => {
      // @ts-expect-error Resolved input mode is readonly.
      actual.mode = 'video';
    }, TypeError);
  });
}

test('resolves relative input and explicit cover from process.cwd()', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc', 'chosen cover.PNG']);
  assert.deepEqual(await resolveInputs({
    inputPath: relative(process.cwd(), join(dir, 'song.mp3')),
    cover: relative(process.cwd(), join(dir, 'chosen cover.PNG')),
  }), {
    mode: 'mp3', audioPath: join(dir, 'song.mp3'), lrcPath: join(dir, 'song.lrc'),
    coverPath: join(dir, 'chosen cover.PNG'),
  });
});

test('rejects MP3 without matching LRC even if other LRC files exist', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'other.lrc', 'song.png']);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3') }), /lrc/i);
});

test('rejects MP3 without matching cover even if other images exist', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc', 'other.png']);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3') }), /cover|image/i);
});

test('rejects ambiguous cover images and requests explicit cover', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc', 'song.png', 'song.jpg']);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3') }), /cover/i);
});

test('explicit cover overrides ambiguous neighboring images', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc', 'song.png', 'song.jpg', 'chosen.jpeg']);
  const result = await resolveInputs({ inputPath: join(dir, 'song.mp3'), cover: join(dir, 'chosen.jpeg') });
  assert(result.mode === 'mp3');
  assert.equal(result.coverPath, join(dir, 'chosen.jpeg'));
});

test('explicit cover must exist', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc', 'song.png']);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3'), cover: join(dir, 'missing.jpg') }), /cover|ENOENT/i);
});

test('explicit cover must have a supported image extension', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc', 'song.png', 'cover.gif']);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3'), cover: join(dir, 'cover.gif') }), /cover|image|extension/i);
});

test('directories are not matching companions or explicit covers', async (t) => {
  const dir = await fixture(t, ['song.mp3', 'song.lrc']);
  await mkdir(join(dir, 'song.png'));
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3') }), /cover|image/i);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'song.mp3'), cover: join(dir, 'song.png') }), /cover|file/i);
});

for (const ext of ['mp4', 'mov', 'MP4', 'MoV']) {
  test(`video ${ext} ignores neighboring LRC/images and an invalid cover`, async (t) => {
    const dir = await fixture(t, [`映像 sample.${ext}`, '映像 sample.lrc', '映像 sample.png', '映像 sample.jpg']);
    const inputPath = join(dir, `映像 sample.${ext}`);
    const actual = await resolveInputs({ inputPath, cover: join(dir, 'missing.gif') });
    assert.deepEqual(actual, { mode: 'video', videoPath: inputPath });
    assert.equal(Object.isFrozen(actual), true);
  });
}

test('video does not require neighboring companions', async (t) => {
  const dir = await fixture(t, ['clip.mp4']);
  assert.deepEqual(await resolveInputs({ inputPath: join(dir, 'clip.mp4') }), {
    mode: 'video', videoPath: join(dir, 'clip.mp4'),
  });
});

for (const name of ['song.wav', 'song.flac', 'clip.webm', 'song']) {
  test(`rejects unsupported input ${name}`, async (t) => {
    const dir = await fixture(t, [name]);
    await assert.rejects(resolveInputs({ inputPath: join(dir, name) }), /unsupported|extension/i);
  });
}

test('input must exist and be a file', async (t) => {
  const dir = await fixture(t, []);
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'missing.mp3') }), /input|ENOENT/i);
  await mkdir(join(dir, 'directory.mp4'));
  await assert.rejects(resolveInputs({ inputPath: join(dir, 'directory.mp4') }), /input|file/i);
});
