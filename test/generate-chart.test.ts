import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AudioAnalysis, TempoEstimate } from '../src/chart/audio-analysis.ts';
import { generateChart } from '../src/chart/generate-chart.ts';

function fixture(): { analysis: AudioAnalysis; tempo: TempoEstimate } {
  const sampleRate = 11025;
  const hopSize = 128;
  const frames = Math.ceil(16 * sampleRate / hopSize);
  const rms = new Float64Array(frames);
  const peaks = [];
  for (let time = 0.25, index = 0; time < 16; time += 0.125, index += 1) {
    const active = time < 4 || (time >= 8 && time < 12);
    if (!active) continue;
    const frame = Math.floor(time * sampleRate / hopSize);
    for (let offset = -4; offset <= 4; offset += 1) {
      if (rms[frame + offset] !== undefined) rms[frame + offset] = 0.7;
    }
    const high = index % 5 === 0;
    peaks.push({
      time, strength: Math.round(time * 8) % 8 === 0 ? 3 : 1.4,
      band: high ? 2 : index % 2, bands: high ? [0.4, 0.7, 1.4] : [1, 0.7, 0.4], rms: 0.7,
    });
  }
  return {
    analysis: {
      onset: new Float64Array(frames), peaks, rms,
      duration: 16, sampleRate, hopSize,
    },
    tempo: { bpm: 120, offset: 0, confidence: 0.9, phaseCoherence: 0.8 },
  };
}

function chart(difficulty: 'easy' | 'normal' | 'hard', seed = 12345) {
  return generateChart({
    ...fixture(), audioName: 'song.mp3', difficulty, seed,
  });
}

test('difficulty increases density and silence bars stay empty', () => {
  const easy = chart('easy');
  const normal = chart('normal');
  const hard = chart('hard');
  assert(easy.notes.length < normal.notes.length);
  assert(normal.notes.length < hard.notes.length);
  for (const generated of [easy, normal, hard]) {
    assert(generated.notes.every((note) => note.time < 4 || (note.time >= 8 && note.time < 12)));
  }
});

test('four-lane assignment is balanced', () => {
  const generated = chart('hard');
  const counts = [0, 0, 0, 0];
  for (const note of generated.notes) counts[note.lane]! += 1;
  assert(Math.max(...counts) - Math.min(...counts) <= Math.ceil(generated.notes.length * 0.2));
});

test('seed is deterministic and only changes lanes', () => {
  const first = chart('normal', 12345);
  const repeated = chart('normal', 12345);
  const changed = chart('normal', 54321);
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.notes.map((note) => note.time), changed.notes.map((note) => note.time));
  assert.notDeepEqual(first.notes.map((note) => note.lane), changed.notes.map((note) => note.lane));
});

test('chords are equal-time notes on independent lanes', () => {
  const generated = chart('hard');
  const byTime = new Map<number, typeof generated.notes>();
  for (const note of generated.notes) {
    const notes = byTime.get(note.time) ?? [];
    byTime.set(note.time, [...notes, note]);
  }
  const chords = [...byTime.values()].filter((notes) => notes.length > 1);
  assert(chords.length > 0);
  for (const notes of chords) {
    assert.equal(new Set(notes.map((note) => note.lane)).size, notes.length);
  }
});

test('normal and hard charts contain tap, hold, and directional flick notes', () => {
  for (const difficulty of ['normal', 'hard'] as const) {
    const generated = chart(difficulty);
    const types = new Set(generated.notes.map((note) => note.type));
    assert.deepEqual(types, new Set(['tap', 'hold', 'flick']));
    for (const note of generated.notes) {
      if (note.type === 'hold') assert(note.duration > 0);
      if (note.type === 'flick') assert(['left', 'right', 'up', 'down'].includes(note.direction));
    }
  }
});
