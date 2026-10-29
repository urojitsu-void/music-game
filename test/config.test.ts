import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';

import { loadConfig, type ConfigOverrides } from '../src/build/config.ts';

// Compile-time check only: callers cannot mutate configuration overrides.
function checkConfigOverrideTypes(overrides: ConfigOverrides): void {
  // @ts-expect-error Configuration override properties are readonly.
  overrides.difficulty = 'easy';
}

async function fixture(t: TestContext, value?: unknown) {
  const cwd = await mkdtemp(join(tmpdir(), 'music-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const inputDir = join(cwd, '曲 の素材');
  await mkdir(inputDir);
  if (value !== undefined) {
    await writeFile(join(inputDir, 'music-game.config.json'), JSON.stringify(value));
  }
  return { cwd, inputPath: join(inputDir, 'song.mp3'), inputDir };
}

test('loadConfig returns exact defaults as deeply immutable plain data', async (t) => {
  const options = await fixture(t);
  const config = await loadConfig(options);
  const layout = config.layout;
  assert.deepEqual(config, {
    difficulty: 'normal', seed: 12345, outDir: join(options.cwd, 'output'), cover: null,
    layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
  });
  assert.equal(Object.getPrototypeOf(config), Object.prototype);
  assert.equal(Object.getPrototypeOf(config.layout), Object.prototype);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.layout), true);
  assert.throws(() => {
    // @ts-expect-error Resolved layout properties are readonly.
    layout.gameX = 0;
  }, TypeError);
});

test('loadConfig reads all permitted keys from the input directory', async (t) => {
  const value = {
    difficulty: 'hard', seed: -42, outDir: 'renders', cover: '表紙.png',
    layout: { gameX: 0.4, gameY: 0.9, gameWidth: 0.6, gameHeight: 0.7 },
  };
  const options = await fixture(t, value);
  assert.deepEqual(await loadConfig(options), {
    ...value, outDir: join(options.cwd, 'renders'), cover: join(options.cwd, '表紙.png'),
  });
});

test('CLI overrides config and merges partial layouts without mutating CLI', async (t) => {
  const options = await fixture(t, {
    difficulty: 'easy', seed: 4, outDir: 'json-out', cover: 'json.jpg',
    layout: { gameX: 0.4, gameY: 0.9, gameWidth: 0.6 },
  });
  const cli = Object.freeze({
    difficulty: 'hard', seed: 0, outDir: 'cli-out', cover: null,
    layout: Object.freeze({ gameWidth: 0.4 }),
  });
  assert.deepEqual(await loadConfig({ ...options, cli }), {
    difficulty: 'hard', seed: 0, outDir: join(options.cwd, 'cli-out'), cover: null,
    layout: { gameX: 0.4, gameY: 0.9, gameWidth: 0.4, gameHeight: 0.68 },
  });
});

test('only defined CLI values override configuration', async (t) => {
  const options = await fixture(t, { difficulty: 'easy', layout: { gameX: 0.45 } });
  const config = await loadConfig({ ...options, cli: { difficulty: undefined, layout: undefined } });
  assert.equal(config.difficulty, 'easy');
  assert.equal(config.layout.gameX, 0.45);
});

test('relative input, output, and cover paths resolve from cwd', async (t) => {
  const options = await fixture(t, { difficulty: 'easy' });
  const config = await loadConfig({
    cwd: options.cwd, inputPath: '曲 の素材/song.mp3',
    cli: { outDir: './動画 出力', cover: './画像/表紙.jpeg' },
  });
  assert.equal(config.difficulty, 'easy');
  assert.equal(config.outDir, join(options.cwd, '動画 出力'));
  assert.equal(config.cover, join(options.cwd, '画像/表紙.jpeg'));
});

test('cwd defaults to process.cwd() and absolute paths remain absolute', async (t) => {
  const options = await fixture(t);
  const config = await loadConfig({ inputPath: options.inputPath, cli: { cover: '/tmp/cover.jpg' } });
  assert.equal(config.outDir, resolve(process.cwd(), 'output'));
  assert.equal(config.cover, '/tmp/cover.jpg');
});

for (const difficulty of ['easy', 'normal', 'hard']) {
  test(`accepts difficulty ${difficulty}`, async (t) => {
    const options = await fixture(t, { difficulty });
    assert.equal((await loadConfig(options)).difficulty, difficulty);
  });
}

for (const seed of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0]) {
  test(`accepts safe integer seed ${seed}`, async (t) => {
    const options = await fixture(t, { seed });
    assert.equal((await loadConfig(options)).seed, seed);
  });
}

const invalidValues: [string, unknown][] = [
  ['difficulty', 'expert'], ['difficulty', 1], ['difficulty', null],
  ['seed', '123'], ['seed', 1.5], ['seed', Number.MAX_SAFE_INTEGER + 1], ['seed', NaN],
  ['seed', Infinity], ['seed', null], ['outDir', 2], ['outDir', null],
  ['cover', false], ['cover', {}], ['layout', null], ['layout', []],
  ['layout', 'wide'], ['layout', { extra: 0.3 }],
  ['layout', { gameX: '0.5' }], ['layout', { gameY: null }],
  ['layout', { gameWidth: NaN }], ['layout', { gameHeight: Infinity }],
  ['layout', { gameX: -0.1 }], ['layout', { gameX: 1.1 }],
  ['layout', { gameY: -0.1 }], ['layout', { gameY: 1.1 }],
  ['layout', { gameWidth: 0 }], ['layout', { gameWidth: -0.1 }],
  ['layout', { gameWidth: 1.1 }], ['layout', { gameHeight: 0 }],
  ['layout', { gameHeight: -0.1 }], ['layout', { gameHeight: 1.1 }],
  ['layout', { gameX: 0.1 }], ['layout', { gameX: 0.9 }],
  ['layout', { gameY: 0.5 }], ['unexpected', true],
];

for (const [index, [key, value]] of invalidValues.entries()) {
  test(`rejects invalid CLI key/type/layout case ${index}: ${key}`, async (t) => {
    const options = await fixture(t);
    await assert.rejects(loadConfig({ ...options, cli: { [key]: value } }), /config|layout|difficulty|seed|outDir|cover|unknown/i);
  });
}

test('rejects invalid JSON config even when CLI would override it', async (t) => {
  const options = await fixture(t, { difficulty: 'expert' });
  await assert.rejects(loadConfig({ ...options, cli: { difficulty: 'easy' } }), /difficulty/i);
});

for (const value of [null, [], 'config', { unknown: 1 }, { layout: { unknown: 1 } }]) {
  test(`rejects non-object or unknown config: ${JSON.stringify(value)}`, async (t) => {
    const options = await fixture(t, value);
    await assert.rejects(loadConfig(options), /config|layout|unknown/i);
  });
}

test('reports malformed JSON instead of silently using defaults', async (t) => {
  const options = await fixture(t);
  await writeFile(join(options.inputDir, 'music-game.config.json'), '{invalid');
  await assert.rejects(loadConfig(options), /JSON|config/i);
});

test('accepts layout exactly touching every boundary', async (t) => {
  const options = await fixture(t, {
    layout: { gameX: 0.5, gameY: 1, gameWidth: 1, gameHeight: 1 },
  });
  assert.deepEqual((await loadConfig(options)).layout, {
    gameX: 0.5, gameY: 1, gameWidth: 1, gameHeight: 1,
  });
});
