import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPointerInputTranslator, laneFromClientX,
} from '../src/play/pointer-input.ts';

const rect = { left: 10, width: 400 };

test('pointer input maps canvas x positions to four lanes', () => {
  assert.equal(laneFromClientX(10, rect), 0);
  assert.equal(laneFromClientX(109.9, rect), 0);
  assert.equal(laneFromClientX(110, rect), 1);
  assert.equal(laneFromClientX(210, rect), 2);
  assert.equal(laneFromClientX(310, rect), 3);
  assert.equal(laneFromClientX(409.9, rect), 3);
  assert.equal(laneFromClientX(9.9, rect), null);
  assert.equal(laneFromClientX(410, rect), null);
});

test('pointer input emits press and release for a tap', () => {
  const translator = createPointerInputTranslator();

  assert.deepEqual(translator.handle({
    type: 'pointerdown', pointerId: 1, x: 50, y: 100, timeMs: 1_000, rect,
  }), [
    { action: 'press', lane: 0, timeMs: 1_000, pointerId: 1 },
  ]);
  assert.deepEqual(translator.handle({
    type: 'pointerup', pointerId: 1, x: 55, y: 103, timeMs: 1_100, rect,
  }), [
    { action: 'release', lane: 0, timeMs: 1_100, pointerId: 1 },
  ]);
});

test('pointer input recognizes a 24px dominant swipe as a directional flick', () => {
  const cases = [
    [24, 2, 'right'],
    [-24, -2, 'left'],
    [2, -24, 'up'],
    [-2, 24, 'down'],
  ] as const;

  for (const [index, [dx, dy, direction]] of cases.entries()) {
    const translator = createPointerInputTranslator();
    translator.handle({
      type: 'pointerdown', pointerId: index, x: 150, y: 100, timeMs: 0, rect,
    });
    assert.deepEqual(translator.handle({
      type: 'pointermove',
      pointerId: index,
      x: 150 + dx,
      y: 100 + dy,
      timeMs: 50,
      rect,
    }), [
      { action: 'flick', lane: 1, direction, timeMs: 50, pointerId: index },
    ]);
    assert.deepEqual(translator.handle({
      type: 'pointerup', pointerId: index, x: 150 + dx, y: 100 + dy, timeMs: 60, rect,
    }), []);
  }
});

test('pointer input rejects short and ambiguous diagonal movement as flicks', () => {
  const translator = createPointerInputTranslator();
  translator.handle({ type: 'pointerdown', pointerId: 1, x: 50, y: 50, timeMs: 0, rect });

  assert.deepEqual(translator.handle({
    type: 'pointermove', pointerId: 1, x: 73, y: 50, timeMs: 10, rect,
  }), []);
  assert.deepEqual(translator.handle({
    type: 'pointermove', pointerId: 1, x: 80, y: 78, timeMs: 20, rect,
  }), []);
  assert.deepEqual(translator.handle({
    type: 'pointerup', pointerId: 1, x: 80, y: 78, timeMs: 30, rect,
  }), [
    { action: 'release', lane: 0, timeMs: 30, pointerId: 1 },
  ]);
});

test('pointer input tracks simultaneous pointers independently', () => {
  const translator = createPointerInputTranslator();

  assert.deepEqual(translator.handle({
    type: 'pointerdown', pointerId: 10, x: 50, y: 100, timeMs: 0, rect,
  })[0]?.lane, 0);
  assert.deepEqual(translator.handle({
    type: 'pointerdown', pointerId: 20, x: 350, y: 100, timeMs: 1, rect,
  })[0]?.lane, 3);
  assert.deepEqual(translator.handle({
    type: 'pointerup', pointerId: 20, x: 350, y: 100, timeMs: 20, rect,
  })[0]?.lane, 3);
  assert.deepEqual(translator.handle({
    type: 'pointerup', pointerId: 10, x: 50, y: 100, timeMs: 21, rect,
  })[0]?.lane, 0);
});

test('pointer cancel releases and removes only the cancelled pointer', () => {
  const translator = createPointerInputTranslator();
  translator.handle({ type: 'pointerdown', pointerId: 1, x: 50, y: 50, timeMs: 0, rect });
  translator.handle({ type: 'pointerdown', pointerId: 2, x: 350, y: 50, timeMs: 0, rect });

  assert.deepEqual(translator.handle({
    type: 'pointercancel', pointerId: 1, x: 50, y: 50, timeMs: 10, rect,
  }), [
    { action: 'release', lane: 0, timeMs: 10, pointerId: 1 },
  ]);
  assert.deepEqual(translator.handle({
    type: 'pointerup', pointerId: 1, x: 50, y: 50, timeMs: 20, rect,
  }), []);
  assert.equal(translator.handle({
    type: 'pointerup', pointerId: 2, x: 350, y: 50, timeMs: 20, rect,
  })[0]?.lane, 3);
});
