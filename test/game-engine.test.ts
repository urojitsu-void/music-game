import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chart, ChartNote } from '../src/chart/schema.ts';
import {
  createGameEngine, judgeTiming, rankForScore, type Judgment,
} from '../src/play/game-engine.ts';

function chart(notes: readonly ChartNote[], duration = 10): Chart {
  return {
    formatVersion: 1,
    audio: 'song.mp3',
    duration,
    bpm: 120,
    beatOffset: 0,
    beatsPerBar: 4,
    difficulty: 'normal',
    lanes: 4,
    seed: 1,
    notes,
    statistics: {},
  };
}

test('game engine applies inclusive judgment boundaries', () => {
  const cases: readonly [number, Judgment][] = [
    [0, 'PERFECT'],
    [0.05, 'PERFECT'],
    [0.051, 'GREAT'],
    [0.1, 'GREAT'],
    [0.101, 'GOOD'],
    [0.15, 'GOOD'],
    [0.151, 'BAD'],
    [0.22, 'BAD'],
    [0.221, 'MISS'],
  ];

  for (const [absoluteOffset, expected] of cases) {
    assert.equal(judgeTiming(absoluteOffset), expected);
    assert.equal(judgeTiming(-absoluteOffset), expected);
  }
});

test('game engine adds fixed judgment scores', () => {
  const engine = createGameEngine(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'tap', time: 2, lane: 0 },
    { type: 'tap', time: 3, lane: 0 },
    { type: 'tap', time: 4, lane: 0 },
    { type: 'tap', time: 5, lane: 0 },
  ]));

  assert.equal(engine.input({ action: 'press', lane: 0, time: 1 })?.judgment, 'PERFECT');
  assert.equal(engine.input({ action: 'press', lane: 0, time: 2.08 })?.judgment, 'GREAT');
  assert.equal(engine.input({ action: 'press', lane: 0, time: 3.13 })?.judgment, 'GOOD');
  assert.equal(engine.input({ action: 'press', lane: 0, time: 4.2 })?.judgment, 'BAD');
  engine.advance(5.221);

  assert.equal(engine.snapshot.score, 2_100);
  assert.deepEqual(engine.snapshot.counts, {
    PERFECT: 1, GREAT: 1, GOOD: 1, BAD: 1, MISS: 1,
  });
});

test('game engine continues combo only for GREAT or better', () => {
  const engine = createGameEngine(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'tap', time: 2, lane: 0 },
    { type: 'tap', time: 3, lane: 0 },
    { type: 'tap', time: 4, lane: 0 },
    { type: 'tap', time: 5, lane: 0 },
  ]));

  engine.input({ action: 'press', lane: 0, time: 1 });
  engine.input({ action: 'press', lane: 0, time: 2.08 });
  assert.equal(engine.snapshot.combo, 2);
  engine.input({ action: 'press', lane: 0, time: 3.13 });
  assert.equal(engine.snapshot.combo, 0);
  engine.input({ action: 'press', lane: 0, time: 4 });
  assert.equal(engine.snapshot.combo, 1);
  engine.input({ action: 'press', lane: 0, time: 5.2 });

  assert.equal(engine.snapshot.combo, 0);
  assert.equal(engine.snapshot.maxCombo, 2);
});

test('game engine judges the nearest unresolved compatible event on the lane', () => {
  const engine = createGameEngine(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'tap', time: 1.3, lane: 0 },
    { type: 'tap', time: 1.3, lane: 1 },
  ]));

  const result = engine.input({ action: 'press', lane: 0, time: 1.16 });

  assert.equal(result?.eventId, '1:tap');
  assert.equal(result?.judgment, 'GOOD');
  assert.deepEqual(engine.snapshot.unresolvedEventIds, ['0:tap', '2:tap']);
});

test('game engine accepts a hold release only after its start was judged', () => {
  const withoutStart = createGameEngine(chart([
    { type: 'hold', time: 1, lane: 0, duration: 2 },
  ]));
  assert.equal(withoutStart.input({ action: 'release', lane: 0, time: 2.95 }), null);
  assert.deepEqual(withoutStart.snapshot.unresolvedEventIds, ['0:hold-end']);

  const held = createGameEngine(chart([
    { type: 'hold', time: 1, lane: 0, duration: 2 },
  ]));
  assert.equal(held.input({ action: 'press', lane: 0, time: 1 })?.judgment, 'PERFECT');
  assert.equal(held.input({ action: 'release', lane: 0, time: 3.08 })?.judgment, 'GREAT');
  assert.equal(held.snapshot.completed, true);
});

test('game engine judges an early hold release as BAD', () => {
  const engine = createGameEngine(chart([
    { type: 'hold', time: 1, lane: 0, duration: 2 },
  ]));
  engine.input({ action: 'press', lane: 0, time: 1 });

  const release = engine.input({ action: 'release', lane: 0, time: 1.5 });

  assert.equal(release?.eventId, '0:hold-end');
  assert.equal(release?.judgment, 'BAD');
  assert.equal(engine.snapshot.completed, true);
});

test('game engine automatically confirms MISS after the BAD window', () => {
  const engine = createGameEngine(chart([{ type: 'tap', time: 1, lane: 0 }]));

  engine.advance(1.22);
  assert.equal(engine.snapshot.completed, false);
  engine.advance(1.221);

  assert.equal(engine.snapshot.completed, true);
  assert.equal(engine.snapshot.counts.MISS, 1);
  assert.equal(engine.snapshot.judgments[0]?.eventId, '0:tap');
});

test('game engine bases max score and gauge on all judgment events', () => {
  const engine = createGameEngine(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'hold', time: 2, lane: 1, duration: 1 },
  ]));

  engine.input({ action: 'press', lane: 0, time: 1 });
  engine.input({ action: 'press', lane: 1, time: 2 });

  assert.equal(engine.snapshot.maxScore, 3_000);
  assert.equal(engine.snapshot.score, 2_000);
  assert.equal(engine.snapshot.gauge, 2 / 3);
});

test('rank thresholds are based on the theoretical maximum score', () => {
  assert.equal(rankForScore(800, 1_000), 'S');
  assert.equal(rankForScore(799, 1_000), 'A');
  assert.equal(rankForScore(700, 1_000), 'A');
  assert.equal(rankForScore(699, 1_000), 'B');
  assert.equal(rankForScore(600, 1_000), 'B');
  assert.equal(rankForScore(599, 1_000), 'C');
  assert.equal(rankForScore(500, 1_000), 'C');
  assert.equal(rankForScore(499, 1_000), 'D');
});

test('game engine awards FULL COMBO only when every judgment is GREAT or better', () => {
  const fullCombo = createGameEngine(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'tap', time: 2, lane: 1 },
  ]));
  fullCombo.input({ action: 'press', lane: 0, time: 1 });
  fullCombo.input({ action: 'press', lane: 1, time: 2.08 });
  assert.equal(fullCombo.snapshot.fullCombo, true);

  const broken = createGameEngine(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'tap', time: 2, lane: 1 },
  ]));
  broken.input({ action: 'press', lane: 0, time: 1 });
  broken.input({ action: 'press', lane: 1, time: 2.13 });
  assert.equal(broken.snapshot.fullCombo, false);
});
