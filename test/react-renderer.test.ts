import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { bundleRenderer } from '../src/render/build-renderer.ts';

test('bundleRenderer builds a React canvas screen for the browser', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'react-renderer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await bundleRenderer(directory);
  assert.equal(result.htmlPath, join(directory, 'renderer.html'));
  assert.equal(result.scriptPath, join(directory, 'renderer.js'));
  const html = await readFile(result.htmlPath, 'utf8');
  const script = await readFile(result.scriptPath, 'utf8');
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /renderer\.js/);
  assert.match(script, /createRoot/);
  assert.match(script, /window\.renderer/);
});
