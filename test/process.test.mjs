import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  commandExists,
  runProcess,
  spawnProcess,
} from '../src/platform/process.mjs';

test('runProcess captures stdout and stderr while preserving arguments', async () => {
  const value = 'HERE × HEAR';
  const result = await runProcess(process.execPath, [
    '-e',
    'process.stdout.write(process.argv[1]); process.stderr.write("warning")',
    value,
  ]);

  assert.deepEqual(result, {
    stdout: value,
    stderr: 'warning',
  });
});

test('runProcess rejects nonzero exits with process diagnostics', async () => {
  await assert.rejects(
    runProcess(process.execPath, [
      '-e',
      'process.stderr.write("broken"); process.exit(7)',
    ]),
    (error) => {
      assert.equal(error.command, process.execPath);
      assert.equal(error.code, 7);
      assert.equal(error.stderr, 'broken');
      return true;
    },
  );
});

test('spawnProcess exposes writable stdin and resolves after a zero exit', async () => {
  const { child, completed } = spawnProcess(process.execPath, [
    '-e',
    'process.stdin.resume(); process.stdin.once("end", () => setTimeout(() => process.exit(0), 30))',
  ], { stdin: 'pipe' });

  assert.equal(child.stdin.writable, true);
  let settled = false;
  completed.finally(() => { settled = true; });
  child.stdin.end('PNG bytes');

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);
  await completed;
  assert.equal(settled, true);
});

test('spawnProcess rejects nonzero exits with process diagnostics', async () => {
  const { completed } = spawnProcess(process.execPath, [
    '-e',
    'process.stderr.write("renderer failed"); process.exit(9)',
  ], { stdin: 'pipe' });

  await assert.rejects(completed, (error) => {
    assert.equal(error.command, process.execPath);
    assert.equal(error.code, 9);
    assert.equal(error.stderr, 'renderer failed');
    return true;
  });
});

test('spawnProcess decodes split UTF-8 stderr without corruption', async () => {
  const { completed } = spawnProcess(process.execPath, [
    '-e',
    'process.stderr.write(Buffer.from([0xe3])); setTimeout(() => { process.stderr.write(Buffer.from([0x81, 0x82])); process.exit(4); }, 20)',
  ], { stdin: 'pipe' });

  await assert.rejects(completed, (error) => {
    assert.equal(error.stderr, 'あ');
    return true;
  });
});

test('spawnProcess rejects spawn errors', async () => {
  const command = `missing-command-${process.pid}-${Date.now()}`;
  const { completed } = spawnProcess(command, [], { stdin: 'pipe' });

  await assert.rejects(completed, (error) => {
    assert.equal(error.command, command);
    assert.equal(error.code, 'ENOENT');
    return true;
  });
});

test('spawnProcess propagates child errors and terminates the child', async () => {
  const { child, completed } = spawnProcess(process.execPath, [
    '-e',
    'setTimeout(() => process.exit(0), 250)',
  ], { stdin: 'pipe' });
  const error = new Error('child stream failed');

  child.emit('error', error);

  await assert.rejects(completed, (actual) => actual === error);
  await new Promise((resolve) => child.once('close', resolve));
  assert.equal(child.signalCode, 'SIGTERM');
});

test('spawnProcess propagates stdin EPIPE and terminates the child', async () => {
  const { child, completed } = spawnProcess(process.execPath, [
    '-e',
    'process.stderr.write("encoder warning"); setInterval(() => {}, 1000)',
  ], { stdin: 'pipe' });
  const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

  await new Promise((resolve) => child.stderr.once('data', resolve));

  child.stdin.emit('error', error);

  await assert.rejects(completed, (actual) => {
    assert.equal(actual, error);
    assert.equal(actual.command, process.execPath);
    assert.equal(actual.stderr, 'encoder warning');
    return true;
  });
  await new Promise((resolve) => child.once('close', resolve));
  assert.equal(child.exitCode === null ? child.signalCode : child.exitCode, 'SIGTERM');
});

test('commandExists finds the current Node executable', async () => {
  assert.equal(await commandExists(process.execPath), true);
});
