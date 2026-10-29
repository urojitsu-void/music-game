import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  hashFile,
  hashValue,
  invalidateDependents,
  isStageHit,
  readManifest,
  recordStage,
  type BuildManifest,
} from '../src/build/manifest.ts';

async function fixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'music-manifest-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('hashValue is stable across object key order', () => {
  assert.equal(
    hashValue({ beta: [2, { y: true, x: null }], alpha: 'one' }),
    hashValue({ alpha: 'one', beta: [2, { x: null, y: true }] }),
  );
  assert.notEqual(hashValue([1, 2]), hashValue([2, 1]));
});

test('hashFile returns the SHA-256 of file contents', async (t) => {
  const directory = await fixture(t);
  const path = join(directory, 'artifact.bin');
  await writeFile(path, 'hello');
  assert.equal(
    await hashFile(path),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  );
});

test('readManifest safely misses broken and unknown formats', async (t) => {
  const directory = await fixture(t);
  const path = join(directory, 'build-manifest.json');
  assert.equal(await readManifest(path), null);
  await writeFile(path, '{broken');
  assert.equal(await readManifest(path), null);
  await writeFile(path, JSON.stringify({ formatVersion: 2, resolvedConfig: {}, stages: {} }));
  assert.equal(await readManifest(path), null);
});

test('isStageHit requires matching key, artifact, and hash', async (t) => {
  const directory = await fixture(t);
  const artifactPath = join(directory, 'chart.json');
  await writeFile(artifactPath, 'chart');
  const artifactHash = await hashFile(artifactPath);
  const manifest: BuildManifest = {
    formatVersion: 1,
    resolvedConfig: {},
    stages: {
      chart: { key: 'key', artifactHash, completedAt: '2026-10-29T00:00:00.000Z' },
    },
  };

  assert.equal(await isStageHit({ manifest, stage: 'chart', key: 'key', artifactPath }), true);
  assert.equal(await isStageHit({ manifest, stage: 'chart', key: 'other', artifactPath }), false);
  await writeFile(artifactPath, 'changed');
  assert.equal(await isStageHit({ manifest, stage: 'chart', key: 'key', artifactPath }), false);
  assert.equal(await isStageHit({ manifest, stage: 'chart', key: 'key', artifactPath: join(directory, 'missing') }), false);
});

test('isStageHit can require video background analysis metadata', async (t) => {
  const directory = await fixture(t);
  const artifactPath = join(directory, 'background.mp4');
  await writeFile(artifactPath, 'video');
  const manifest: BuildManifest = {
    formatVersion: 1,
    resolvedConfig: {},
    stages: {
      background: {
        key: 'key', artifactHash: await hashFile(artifactPath),
        completedAt: '2026-10-29T00:00:00.000Z', metadata: {},
      },
    },
  };

  assert.equal(await isStageHit({
    manifest, stage: 'background', key: 'key', artifactPath,
    requiredMetadata: ['analysisAudioHash'],
  }), false);
  const withMetadata: BuildManifest = {
    ...manifest,
    stages: {
      ...manifest.stages,
      background: {
        ...manifest.stages.background!,
        metadata: { analysisAudioHash: 'audio-hash' },
      },
    },
  };
  assert.equal(await isStageHit({
    manifest: withMetadata, stage: 'background', key: 'key', artifactPath,
    requiredMetadata: ['analysisAudioHash'],
  }), true);
});

function completeManifest(): BuildManifest {
  const entry = (key: string) => ({
    key, artifactHash: `${key}-hash`, completedAt: '2026-10-29T00:00:00.000Z',
  });
  return {
    formatVersion: 1,
    resolvedConfig: {},
    stages: {
      background: entry('background'), chart: entry('chart'),
      overlay: entry('overlay'), final: entry('final'),
    },
  };
}

test('invalidation follows dependencies without deleting unrelated stages', () => {
  const fromBackground = invalidateDependents(completeManifest(), 'background');
  assert.deepEqual(Object.keys(fromBackground.stages).sort(), ['background', 'chart', 'overlay']);

  const fromChart = invalidateDependents(completeManifest(), 'chart');
  assert.deepEqual(Object.keys(fromChart.stages).sort(), ['background', 'chart']);

  const fromOverlay = invalidateDependents(completeManifest(), 'overlay');
  assert.deepEqual(Object.keys(fromOverlay.stages).sort(), ['background', 'chart', 'overlay']);
});

test('recordStage atomically preserves unrelated successful stages and metadata', async (t) => {
  const directory = await fixture(t);
  const manifestPath = join(directory, 'build-manifest.json');
  const backgroundPath = join(directory, 'background.mp4');
  const chartPath = join(directory, 'chart.json');
  await writeFile(backgroundPath, 'background');
  await writeFile(chartPath, 'chart');

  await recordStage({
    manifestPath, resolvedConfig: { difficulty: 'normal' }, stage: 'background',
    key: 'background-key', artifactPath: backgroundPath,
    metadata: { analysisAudioHash: 'decoded-audio' },
  });
  await recordStage({
    manifestPath, resolvedConfig: { difficulty: 'normal' }, stage: 'chart',
    key: 'chart-key', artifactPath: chartPath,
  });

  const manifest = await readManifest(manifestPath);
  assert.equal(manifest?.stages.background?.metadata?.analysisAudioHash, 'decoded-audio');
  assert.equal(manifest?.stages.chart?.key, 'chart-key');
  await assert.rejects(readFile(`${manifestPath}.tmp`, 'utf8'), { code: 'ENOENT' });
});
