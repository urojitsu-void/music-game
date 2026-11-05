import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chart } from '../src/chart/schema.ts';
import { expandChartEvents } from '../src/play/game-events.ts';

function chart(notes: Chart['notes']): Chart {
  return {
    formatVersion: 1,
    audio: 'song.mp3',
    duration: 10,
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

test('game events expand tap, flick, and both hold judgments', () => {
  const events = expandChartEvents(chart([
    { type: 'tap', time: 1, lane: 0 },
    { type: 'flick', time: 2, lane: 1, direction: 'up' },
    { type: 'hold', time: 3, lane: 2, duration: 1.5 },
  ]));

  assert.deepEqual(events, [
    { id: '0:tap', noteIndex: 0, kind: 'tap', time: 1, lane: 0 },
    {
      id: '1:flick', noteIndex: 1, kind: 'flick', time: 2, lane: 1, direction: 'up',
    },
    { id: '2:hold-start', noteIndex: 2, kind: 'hold-start', time: 3, lane: 2 },
    { id: '2:hold-end', noteIndex: 2, kind: 'hold-end', time: 4.5, lane: 2 },
  ]);
});

test('game events stay ordered by time and chart order at equal times', () => {
  const events = expandChartEvents(chart([
    { type: 'hold', time: 1, lane: 0, duration: 1 },
    { type: 'tap', time: 2, lane: 1 },
    { type: 'flick', time: 2, lane: 2, direction: 'left' },
  ]));

  assert.deepEqual(events.map(({ id, time }) => [id, time]), [
    ['0:hold-start', 1],
    ['0:hold-end', 2],
    ['1:tap', 2],
    ['2:flick', 2],
  ]);
});
