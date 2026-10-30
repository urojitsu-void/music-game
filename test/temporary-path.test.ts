import assert from 'node:assert/strict';
import { test } from 'node:test';

import { temporarySiblingPath } from '../src/platform/temporary-path.ts';

test('temporary sibling paths are isolated by process id and preserve extensions', () => {
  assert.equal(temporarySiblingPath('/out/overlay.mov', 123), '/out/overlay.123.tmp.mov');
  assert.equal(temporarySiblingPath('/out/overlay.mov', 456), '/out/overlay.456.tmp.mov');
  assert.equal(temporarySiblingPath('/out/chart.json', 123), '/out/chart.123.tmp.json');
  assert.equal(temporarySiblingPath('/out/build.log', 123), '/out/build.123.tmp.log');
});
