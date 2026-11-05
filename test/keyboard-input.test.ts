import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKeyboardInputTranslator, shouldPreventGameKeyDefault,
} from '../src/play/keyboard-input.ts';

test('keyboard input maps ASDF key presses and releases to four lanes', () => {
  const translator = createKeyboardInputTranslator();
  const keys = ['a', 'S', 'd', 'F'] as const;

  for (const [lane, key] of keys.entries()) {
    assert.deepEqual(translator.handle({ type: 'keydown', key, repeat: false, timeMs: lane * 200 }), []);
    assert.deepEqual(translator.flush(lane * 200 + 101), [
      { action: 'press', lane, timeMs: lane * 200 },
    ]);
    assert.deepEqual(translator.handle({
      type: 'keyup', key, repeat: false, timeMs: lane * 200 + 150,
    }), [
      { action: 'release', lane, timeMs: lane * 200 + 150 },
    ]);
  }
});

test('keyboard input recognizes lane then arrow as a flick within 100ms', () => {
  const translator = createKeyboardInputTranslator();

  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'a', repeat: false, timeMs: 1_000,
  }), []);
  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'ArrowUp', repeat: false, timeMs: 1_100,
  }), [
    { action: 'flick', lane: 0, direction: 'up', timeMs: 1_000 },
  ]);
  assert.deepEqual(translator.handle({
    type: 'keyup', key: 'a', repeat: false, timeMs: 1_150,
  }), []);
});

test('keyboard input recognizes arrow then lane as a flick within 100ms', () => {
  const translator = createKeyboardInputTranslator();

  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'ArrowLeft', repeat: false, timeMs: 2_000,
  }), []);
  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'f', repeat: false, timeMs: 2_099,
  }), [
    { action: 'flick', lane: 3, direction: 'left', timeMs: 2_099 },
  ]);
});

test('keyboard input does not combine keys farther than 100ms apart', () => {
  const translator = createKeyboardInputTranslator();
  translator.handle({ type: 'keydown', key: 's', repeat: false, timeMs: 0 });

  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'ArrowRight', repeat: false, timeMs: 101,
  }), [
    { action: 'press', lane: 1, timeMs: 0 },
  ]);
  assert.deepEqual(translator.flush(200), []);
});

test('keyboard input preserves all flick directions for engine validation', () => {
  const translator = createKeyboardInputTranslator();
  const arrows = [
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
  ] as const;

  for (const [index, [key, direction]] of arrows.entries()) {
    const timeMs = index * 300;
    translator.handle({ type: 'keydown', key, repeat: false, timeMs });
    assert.deepEqual(translator.handle({
      type: 'keydown', key: 'd', repeat: false, timeMs: timeMs + 50,
    }), [
      { action: 'flick', lane: 2, direction, timeMs: timeMs + 50 },
    ]);
    translator.handle({ type: 'keyup', key: 'd', repeat: false, timeMs: timeMs + 60 });
  }
});

test('keyboard input ignores repeat and unrelated keys', () => {
  const translator = createKeyboardInputTranslator();

  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'a', repeat: true, timeMs: 0,
  }), []);
  assert.deepEqual(translator.handle({
    type: 'keydown', key: 'Enter', repeat: false, timeMs: 10,
  }), []);
  assert.deepEqual(translator.flush(200), []);
});

test('only active game arrow keys suppress browser defaults', () => {
  assert.equal(shouldPreventGameKeyDefault('ArrowDown', true), true);
  assert.equal(shouldPreventGameKeyDefault('ArrowDown', false), false);
  assert.equal(shouldPreventGameKeyDefault('a', true), false);
  assert.equal(shouldPreventGameKeyDefault(' ', true), false);
});
