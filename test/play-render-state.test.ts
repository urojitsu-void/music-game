import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chart } from '../src/chart/schema.ts';
import { createGameEngine } from '../src/play/game-engine.ts';
import { derivePlayFrameState } from '../src/play/render-state.ts';

function chart(): Chart {
  return {
    formatVersion: 1,
    audio: 'song.mp3',
    duration: 8,
    bpm: 120,
    beatOffset: 0,
    beatsPerBar: 4,
    difficulty: 'normal',
    lanes: 4,
    seed: 1,
    notes: [
      { type: 'tap', time: 2, lane: 0 },
      { type: 'flick', time: 3, lane: 1, direction: 'right' },
      { type: 'hold', time: 4, lane: 2, duration: 1 },
    ],
    statistics: {},
  };
}

test('play render state uses unresolved notes and actual judgment results', () => {
  const gameChart = chart();
  const engine = createGameEngine(gameChart);
  engine.input({ action: 'press', lane: 0, time: 2.08 });

  const state = derivePlayFrameState(gameChart, engine.snapshot, 2.1);

  assert.deepEqual(state.notes.map((note) => note.lane), [1, 2]);
  assert.deepEqual(state.hits.map((hit) => ({ lane: hit.lane, judgment: hit.judgment })), [
    { lane: 0, judgment: 'GREAT' },
  ]);
  assert.equal(state.combo, 1);
  assert.equal(state.score, 700);
  assert.equal(state.gauge, 700 / 4_000);
  assert(state.hitPulse > 0);
  assert.equal(state.fullComboProgress, null);
});

test('play render state keeps a started hold visible until its end is judged', () => {
  const gameChart = chart();
  const engine = createGameEngine(gameChart);
  engine.advance(3.3);
  engine.input({ action: 'press', lane: 2, time: 4 });

  const holding = derivePlayFrameState(gameChart, engine.snapshot, 4.5);
  assert.deepEqual(holding.notes.map((note) => note.type), ['hold']);
  assert.equal(holding.notes[0]?.progress, 1);

  engine.input({ action: 'release', lane: 2, time: 5 });
  const released = derivePlayFrameState(gameChart, engine.snapshot, 5.01);
  assert.deepEqual(released.notes, []);
});
