import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  validateChart, writeChartAtomic, type Chart,
} from '../src/chart/schema.ts';

function validChart(): Chart {
  return {
    formatVersion: 1,
    audio: 'song.mp3',
    duration: 10,
    bpm: 120,
    beatOffset: 0.1,
    beatsPerBar: 4,
    difficulty: 'normal',
    lanes: 4,
    seed: 12345,
    notes: [
      { time: 1, lane: 0, type: 'tap' },
      { time: 1, lane: 2, type: 'flick', direction: 'right' },
      { time: 2, lane: 1, type: 'hold', duration: 1.5 },
    ],
    statistics: {},
  };
}

test('validateChart accepts same-time notes on different lanes', () => {
  assert.deepEqual(validateChart(validChart()).notes, validChart().notes);
});

for (const [name, mutate, path] of [
  ['format', (chart: Record<string, unknown>) => { chart.formatVersion = 2; }, 'chart.formatVersion'],
  ['audio', (chart: Record<string, unknown>) => { chart.audio = ''; }, 'chart.audio'],
  ['duration', (chart: Record<string, unknown>) => { chart.duration = 0; }, 'chart.duration'],
  ['bpm', (chart: Record<string, unknown>) => { chart.bpm = 300; }, 'chart.bpm'],
  ['offset', (chart: Record<string, unknown>) => { chart.beatOffset = -1; }, 'chart.beatOffset'],
  ['beats', (chart: Record<string, unknown>) => { chart.beatsPerBar = 3; }, 'chart.beatsPerBar'],
  ['difficulty', (chart: Record<string, unknown>) => { chart.difficulty = 'expert'; }, 'chart.difficulty'],
  ['lanes', (chart: Record<string, unknown>) => { chart.lanes = 5; }, 'chart.lanes'],
  ['seed', (chart: Record<string, unknown>) => { chart.seed = 1.5; }, 'chart.seed'],
] as const) {
  test(`validateChart rejects invalid ${name}`, () => {
    const value = structuredClone(validChart()) as unknown as Record<string, unknown>;
    mutate(value);
    assert.throws(() => validateChart(value), new RegExp(path.replace('.', '\\.')));
  });
}

test('validateChart rejects note range, type, order, and duplicates with paths', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...validChart(), notes: [{ time: -1, lane: 0, type: 'tap' }] }, /chart\.notes\[0\]\.time/],
    [{ ...validChart(), notes: [{ time: 1, lane: 4, type: 'tap' }] }, /chart\.notes\[0\]\.lane/],
    [{ ...validChart(), notes: [{ time: 1, lane: 0, type: 'slide' }] }, /chart\.notes\[0\]\.type/],
    [{ ...validChart(), notes: [{ time: 1, lane: 0, type: 'hold' }] }, /chart\.notes\[0\]\.duration/],
    [{ ...validChart(), notes: [{ time: 9, lane: 0, type: 'hold', duration: 2 }] }, /chart\.notes\[0\]\.duration/],
    [{ ...validChart(), notes: [{ time: 1, lane: 0, type: 'flick', direction: 'diagonal' }] }, /chart\.notes\[0\]\.direction/],
    [{ ...validChart(), notes: [{ time: 2, lane: 0, type: 'tap' }, { time: 1, lane: 0, type: 'tap' }] }, /chart\.notes/],
    [{ ...validChart(), notes: [{ time: 1, lane: 0, type: 'tap' }, { time: 1, lane: 0, type: 'tap' }] }, /chart\.notes\[1\]/],
  ];
  for (const [value, pattern] of cases) assert.throws(() => validateChart(value), pattern);
});

test('writeChartAtomic writes stable newline-terminated JSON', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'chart-schema-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'chart.json');
  assert.equal(await writeChartAtomic(validChart(), path), path);
  const first = await readFile(path, 'utf8');
  await writeChartAtomic(validChart(), path);
  const second = await readFile(path, 'utf8');
  assert.equal(first, second);
  assert(first.endsWith('\n'));
  await assert.rejects(readFile(`${path}.tmp`), { code: 'ENOENT' });
});
