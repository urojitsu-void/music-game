import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_PATH = join(PROJECT_ROOT, 'music_game_data.command');

test('data command selects an input and runs data:build without subtitles', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'music-game-data-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const capture = join(root, 'npm.txt');
  await mkdir(bin);
  await writeFile(join(bin, 'osascript'), `#!/bin/sh
case "$*" in
  *"choose file"*) printf '%s\n' "$MUSIC_GAME_TEST_INPUT" ;;
  *"display dialog"*) printf '%s\n' "字幕なし" ;;
esac
`, { mode: 0o755 });
  await writeFile(join(bin, 'npm'), `#!/bin/sh
printf '%s\n' "$PWD" "$@" > "$MUSIC_GAME_TEST_CAPTURE"
`, { mode: 0o755 });

  const inputPath = '/tmp/選択した曲.mp3';
  const result = await new Promise<{ code: number | null; stderr: string }>((resolveResult, reject) => {
    const child = spawn(COMMAND_PATH, [], {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        MUSIC_GAME_TEST_INPUT: inputPath,
        MUSIC_GAME_TEST_CAPTURE: capture,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolveResult({ code, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await readFile(capture, 'utf8')).trim().split('\n'), [
    PROJECT_ROOT, 'run', 'data:build', '--', inputPath, '--no-subtitle',
  ]);
  assert.equal((await stat(COMMAND_PATH)).mode & 0o111, 0o111);
});
