import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { installShutdownHandlers } from '../src/platform/signals.ts';

test('shutdown handlers preserve conventional exit codes and escalate repeated signals', () => {
  const events = new EventEmitter() as EventEmitter & { exitCode?: number };
  const calls: string[] = [];
  const supervisor = {
    shutdown: async () => { calls.push('shutdown'); },
  };
  const uninstall = installShutdownHandlers(supervisor, events);

  events.emit('SIGINT');
  assert.equal(events.exitCode, 130);
  assert.deepEqual(calls, ['shutdown']);

  events.emit('SIGINT');
  assert.deepEqual(calls, ['shutdown', 'shutdown']);

  events.exitCode = undefined;
  events.emit('SIGTERM');
  assert.equal(events.exitCode, 143);

  uninstall();
  assert.equal(events.listenerCount('SIGINT'), 0);
  assert.equal(events.listenerCount('SIGTERM'), 0);
});
