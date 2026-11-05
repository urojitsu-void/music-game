import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bundlePlayApp } from '../src/play/build-browser.ts';

test('play bundle emits React game HTML, JavaScript, CSS, and render assets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'music-game-play-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const result = await bundlePlayApp(directory);
  const [html, script, css, tapAsset] = await Promise.all([
    readFile(result.htmlPath, 'utf8'),
    readFile(result.scriptPath, 'utf8'),
    readFile(result.cssPath, 'utf8'),
    stat(join(directory, 'assets', 'note-tap.png')),
  ]);

  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /play\.js/);
  assert.match(html, /play\.css/);
  assert.match(script, /createRoot/);
  assert.match(script, /backgroundVideoUrl/);
  assert.match(script, /\/api\/runtime/);
  assert.match(script, /\/api\/debug\/output/);
  assert.match(script, /loadReleaseCatalog/);
  assert.match(script, /GitHub Releases/);
  assert.doesNotMatch(script, /type:\s*"file"/);
  assert.match(css, /touch-action:\s*none/);
  assert.equal(tapAsset.isFile(), true);
});
