import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlayServerArgs } from '../src/play/server-cli.ts';

test('play server CLI defaults to localhost without debug access', () => {
  assert.deepEqual(parsePlayServerArgs([]), {
    host: '127.0.0.1',
    port: 4173,
    debug: false,
  });
});

test('play server CLI enables explicit LAN and debug modes', () => {
  assert.deepEqual(parsePlayServerArgs(['--host', '0.0.0.0', '--port', '5000', '--debug']), {
    host: '0.0.0.0',
    port: 5000,
    debug: true,
  });
});

test('play server CLI rejects unknown and invalid arguments', () => {
  assert.throws(() => parsePlayServerArgs(['--public']), /Unknown/);
  assert.throws(() => parsePlayServerArgs(['--port', '0']), /port/);
  assert.throws(() => parsePlayServerArgs(['--host']), /host/);
});
