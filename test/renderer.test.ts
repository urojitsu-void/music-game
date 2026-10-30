import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveFrameState, renderFrame } from '../src/render/canvas-renderer.ts';
import type { Chart } from '../src/chart/schema.ts';

function chart(): Chart {
  return {
    formatVersion: 1, audio: 'song.mp3', duration: 10, bpm: 120,
    beatOffset: 0, beatsPerBar: 4, difficulty: 'normal', lanes: 4, seed: 1,
    notes: [
      { time: 2, lane: 0, type: 'hold', duration: 1 },
      { time: 3, lane: 1, type: 'flick', direction: 'right' },
      { time: 3, lane: 3, type: 'tap' },
    ],
    statistics: {},
  };
}

test('deriveFrameState includes travel, independent hits, bursts, and combo', () => {
  const before = deriveFrameState(chart(), 1);
  assert.deepEqual(before.notes.map((note) => note.lane), [0, 1, 3]);
  assert.equal(before.combo, 0);

  const hit = deriveFrameState(chart(), 3.06);
  assert.equal(hit.notes.length, 0);
  assert.deepEqual(hit.hits.map((note) => note.lane), [1, 3]);
  assert.equal(hit.combo, 3);
  assert.equal(hit.gauge, 1);
  assert(hit.hitPulse > 0);
  assert(hit.fullComboProgress !== null);
  assert.deepEqual(hit, deriveFrameState(chart(), 3.06));

  const expired = deriveFrameState(chart(), 3.221);
  assert.equal(expired.hits.length, 0);
});

test('deriveFrameState excludes notes outside the visible window', () => {
  assert.deepEqual(deriveFrameState(chart(), -0.01).notes, []);
  assert.deepEqual(deriveFrameState(chart(), 9).notes, []);
});

test('full combo waits for the final hold to finish', () => {
  const held: Chart = {
    ...chart(),
    notes: [{ time: 3, lane: 1, type: 'hold', duration: 1 }],
  };
  assert.equal(deriveFrameState(held, 3.5).fullComboProgress, null);
  assert.equal(deriveFrameState(held, 4).fullComboProgress, 0);
});

class RecordingContext {
  readonly calls: Array<{ name: string; args: unknown[] }> = [];
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  private call(name: string, ...args: unknown[]): void { this.calls.push({ name, args }); }
  clearRect(...args: number[]): void { this.call('clearRect', ...args); }
  beginPath(): void { this.call('beginPath'); }
  moveTo(...args: number[]): void { this.call('moveTo', ...args); }
  lineTo(...args: number[]): void { this.call('lineTo', ...args); }
  stroke(): void { this.call('stroke'); }
  fill(): void { this.call('fill'); }
  arc(...args: number[]): void { this.call('arc', ...args); }
  fillText(...args: unknown[]): void { this.call('fillText', ...args); }
  strokeText(...args: unknown[]): void { this.call('strokeText', ...args); }
  fillRect(...args: number[]): void { this.call('fillRect', ...args); }
  createRadialGradient(...args: number[]): CanvasGradient {
    this.call('createRadialGradient', ...args);
    return { addColorStop: () => undefined } as CanvasGradient;
  }
  createLinearGradient(...args: number[]): CanvasGradient {
    this.call('createLinearGradient', ...args);
    return { addColorStop: () => undefined } as CanvasGradient;
  }
  drawImage(...args: unknown[]): void { this.call('drawImage', ...args); }
  translate(...args: number[]): void { this.call('translate', ...args); }
  rotate(...args: number[]): void { this.call('rotate', ...args); }
  save(): void { this.call('save'); }
  restore(): void { this.call('restore'); }
}

test('renderFrame clears transparency and draws lines, circles, glow, and combo', () => {
  const context = new RecordingContext();
  const canvas = {
    width: 1280,
    height: 720,
    getContext: (kind: string) => kind === '2d' ? context : null,
  };
  const layout = { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 };
  renderFrame(canvas, chart(), 1, layout, null, { mode: 'autoplay' });
  renderFrame(canvas, chart(), 3.06, layout, null, { mode: 'autoplay' });

  assert.deepEqual(context.calls[0], { name: 'clearRect', args: [0, 0, 1280, 720] });
  assert(context.calls.filter((call) => call.name === 'lineTo').length >= 6);
  assert(context.calls.some((call) => call.name === 'arc'));
  assert(context.calls.some((call) => call.name === 'createRadialGradient'));
  assert(context.calls.some((call) => call.name === 'strokeText' && call.args[0] === '3 COMBO'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === '3 COMBO'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === 'PERFECT'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === 'FULL COMBO'));
  for (const rank of ['D', 'C', 'B', 'A', 'S']) {
    assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === rank));
  }
  assert(context.calls.filter((call) => call.name === 'fillRect').length >= 2);
});
