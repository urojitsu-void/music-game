import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_PATH = join(PROJECT_ROOT, 'music_game.command');

async function fakeCommands(t: TestContext): Promise<{
  bin: string;
  buildCapture: string;
  notificationCapture: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'music-game-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const buildCapture = join(root, 'build.txt');
  const notificationCapture = join(root, 'notifications.txt');
  await writeFile(join(bin, 'osascript'), `#!/bin/sh
case "$*" in
  *"choose file"*"字幕"*) printf '%s\n' "$MUSIC_GAME_TEST_SUBTITLE" ;;
  *"choose file"*) printf '%s\n' "$MUSIC_GAME_TEST_INPUT" ;;
  *"display dialog"*) printf '%s\n' "$MUSIC_GAME_TEST_SUBTITLE_CHOICE" ;;
  *) printf '%s\n' "$*" >> "$MUSIC_GAME_TEST_OSA_CAPTURE" ;;
esac
`, { mode: 0o755 });
  await writeFile(join(bin, 'npm'), `#!/bin/sh
printf '%s\n' "$PWD" "$@" > "$MUSIC_GAME_TEST_BUILD_CAPTURE"
exit "${'$'}{MUSIC_GAME_TEST_NPM_STATUS:-0}"
`, { mode: 0o755 });
  return { bin, buildCapture, notificationCapture };
}

function runLauncher(env: NodeJS.ProcessEnv): Promise<{
  code: number | null;
  stderr: string;
}> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(COMMAND_PATH, [], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolveResult({ code, stderr }));
  });
}

test('launcher passes a selected MP4 to the project build and notifies success', async (t) => {
  const fixture = await fakeCommands(t);
  const inputPath = '/tmp/選択した素材.mp4';
  const result = await runLauncher({
    ...process.env,
    PATH: `${fixture.bin}:/usr/bin:/bin`,
    MUSIC_GAME_TEST_INPUT: inputPath,
    MUSIC_GAME_TEST_SUBTITLE_CHOICE: '字幕なし',
    MUSIC_GAME_TEST_SUBTITLE: '',
    MUSIC_GAME_TEST_BUILD_CAPTURE: fixture.buildCapture,
    MUSIC_GAME_TEST_OSA_CAPTURE: fixture.notificationCapture,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await readFile(fixture.buildCapture, 'utf8')).trim().split('\n'), [
    PROJECT_ROOT, 'run', 'video:generate', '--', inputPath, '--no-subtitle',
  ]);
  assert.match(await readFile(fixture.notificationCapture, 'utf8'), /display notification/);
  assert.equal((await stat(COMMAND_PATH)).mode & 0o111, 0o111);
});

test('launcher lets MP3 users select a subtitle file in Finder', async (t) => {
  const fixture = await fakeCommands(t);
  const inputPath = '/tmp/song.mp3';
  const subtitlePath = '/tmp/歌詞を選択.lrc';
  const result = await runLauncher({
    ...process.env,
    PATH: `${fixture.bin}:/usr/bin:/bin`,
    MUSIC_GAME_TEST_INPUT: inputPath,
    MUSIC_GAME_TEST_SUBTITLE_CHOICE: '字幕を選ぶ',
    MUSIC_GAME_TEST_SUBTITLE: subtitlePath,
    MUSIC_GAME_TEST_BUILD_CAPTURE: fixture.buildCapture,
    MUSIC_GAME_TEST_OSA_CAPTURE: fixture.notificationCapture,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((await readFile(fixture.buildCapture, 'utf8')).trim().split('\n'), [
    PROJECT_ROOT, 'run', 'video:generate', '--', inputPath, '--subtitle', subtitlePath,
  ]);
});

test('launcher preserves a failed build status and displays an alert', async (t) => {
  const fixture = await fakeCommands(t);
  const result = await runLauncher({
    ...process.env,
    PATH: `${fixture.bin}:/usr/bin:/bin`,
    MUSIC_GAME_TEST_INPUT: '/tmp/failure.mov',
    MUSIC_GAME_TEST_SUBTITLE_CHOICE: '字幕なし',
    MUSIC_GAME_TEST_SUBTITLE: '',
    MUSIC_GAME_TEST_BUILD_CAPTURE: fixture.buildCapture,
    MUSIC_GAME_TEST_OSA_CAPTURE: fixture.notificationCapture,
    MUSIC_GAME_TEST_NPM_STATUS: '7',
  });

  assert.equal(result.code, 7, result.stderr);
  assert.match(await readFile(fixture.notificationCapture, 'utf8'), /display alert/);
});
