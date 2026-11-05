import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  comboNumberPalette, deriveFrameState, glowIntensity, renderFrame, type RenderAssets,
} from '../src/render/canvas-renderer.ts';
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
  assert.deepEqual(hit.hits.map((note) => note.lane), [0, 1, 3]);
  assert.equal(hit.combo, 4);
  assert.equal(hit.gauge, 1);
  assert(hit.hitPulse > 0);
  assert.equal(hit.fullComboProgress, null);
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
  const release = deriveFrameState(held, 4.06);
  assert.equal(release.combo, 2);
  assert.equal(release.gauge, 1);
  assert.deepEqual(release.hits.map((hit) => hit.lane), [1]);
  assert.equal(release.fullComboProgress, null);
  assert.equal(deriveFrameState(held, 4.22).fullComboProgress, 0);
});

test('combo number palette changes at score thresholds', () => {
  assert.equal(comboNumberPalette(1)[1], '#ffffff');
  assert.equal(comboNumberPalette(50)[1], '#38dfff');
  assert.equal(comboNumberPalette(100)[1], '#36f58a');
  assert.equal(comboNumberPalette(200)[1], '#ffe04b');
  assert.equal(comboNumberPalette(400)[1], '#ff1744');
});

test('glow intensity oscillates as a bounded sine wave', () => {
  assert.equal(glowIntensity(0, 1), 0.5);
  assert.equal(glowIntensity(0.25, 1), 1);
  assert.equal(glowIntensity(0.75, 1), 0);
});

class RecordingContext {
  readonly calls: Array<{
    name: string;
    args: unknown[];
    fillStyle: string | CanvasGradient | CanvasPattern;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    lineJoin: CanvasLineJoin;
  }> = [];
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  lineJoin: CanvasLineJoin = 'miter';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  private readonly states: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    lineJoin: CanvasLineJoin;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
  }> = [];

  private call(name: string, ...args: unknown[]): void {
    this.calls.push({
      name, args, fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      lineJoin: this.lineJoin,
    });
  }
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
  save(): void {
    this.call('save');
    this.states.push({
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth, lineJoin: this.lineJoin,
      globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
      font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline,
    });
  }
  restore(): void {
    this.call('restore');
    const state = this.states.pop();
    if (state) Object.assign(this, state);
  }
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
  renderFrame(canvas, chart(), 2.06, layout, null, { mode: 'autoplay' });
  renderFrame(canvas, chart(), 3.22, layout, null, { mode: 'autoplay' });

  assert.equal(context.calls[0]?.name, 'clearRect');
  assert.deepEqual(context.calls[0]?.args, [0, 0, 1280, 720]);
  assert(context.calls.filter((call) => call.name === 'lineTo').length >= 6);
  assert(context.calls.some((call) => call.name === 'arc'));
  assert(context.calls.some((call) => call.name === 'createRadialGradient'));
  assert(context.calls.some((call) => call.name === 'strokeText' && call.args[0] === '4 COMBO'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === '4 COMBO'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === 'PERFECT'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === 'FULL COMBO'));
  for (const rank of ['D', 'C', 'B', 'A', 'S']) {
    assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === rank));
  }
  assert(context.calls.filter((call) => call.name === 'fillRect').length >= 2);
});

test('asset combo text is combined at center and emits a matching glow', () => {
  const context = new RecordingContext();
  const canvas = {
    width: 1280, height: 720,
    getContext: (kind: string) => kind === '2d' ? context : null,
  };
  const comboChart: Chart = {
    ...chart(),
    notes: Array.from({ length: 50 }, (_, index) => ({
      time: 2, lane: index % 4, type: 'tap' as const,
    })),
  };
  const asset = { image: {}, width: 100, height: 50 };
  const assets: RenderAssets = {
    tap: asset, hold: asset,
    flick: { left: asset, right: asset, up: asset, down: asset },
    perfect: asset, fullCombo: asset,
    gauge: asset, gaugeGlow: asset, hitRing: asset,
  };

  renderFrame(canvas, comboChart, 2.06,
    { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
    null, { mode: 'autoplay' }, assets);

  const label = context.calls.find((call) => call.name === 'fillText'
    && call.args[0] === 'COMBO 50' && call.globalCompositeOperation === 'source-over');
  const glow = context.calls.find((call) => call.name === 'fillText'
    && call.args[0] === 'COMBO 50' && call.globalCompositeOperation === 'lighter');
  assert(label);
  assert.equal(label.args[1], 640);
  assert.equal(typeof label.fillStyle, 'object');
  assert.equal(label?.lineJoin, 'round');
  assert.equal(glow?.fillStyle, comboNumberPalette(50)[1]);
  assert(glow && glow.globalAlpha > 0);
  assert.equal(glow.lineJoin, 'round');
});

test('manual rendering draws actual judgments, score, combined combo, and glow', () => {
  const context = new RecordingContext();
  const canvas = {
    width: 1280, height: 720,
    getContext: (kind: string) => kind === '2d' ? context : null,
  };
  const asset = { image: {}, width: 100, height: 50 };
  const assets: RenderAssets = {
    tap: asset, hold: asset,
    flick: { left: asset, right: asset, up: asset, down: asset },
    perfect: asset, fullCombo: asset,
    gauge: asset, gaugeGlow: asset, hitRing: asset,
  };
  const baseState = {
    notes: [],
    combo: 50,
    gauge: 0.5,
    hitPulse: 1,
    fullComboProgress: null,
    score: 12_345,
  } as const;
  const judgments = ['GREAT', 'GOOD', 'BAD', 'MISS'] as const;

  for (const judgment of judgments) {
    renderFrame(canvas, chart(), 3,
      { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 },
      null,
      {
        mode: 'manual',
        state: {
          ...baseState,
          hits: [{ type: 'tap', time: 3, lane: 0, progress: 0, judgment }],
        },
      },
      assets);
  }

  for (const judgment of judgments) {
    assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === judgment));
  }
  assert(context.calls.some((call) => call.name === 'fillText'
    && call.args[0] === 'SCORE 12,345'));
  assert(context.calls.some((call) => call.name === 'fillText'
    && call.args[0] === 'COMBO 50' && call.globalCompositeOperation === 'source-over'));
  assert(context.calls.some((call) => call.name === 'fillText'
    && call.args[0] === 'COMBO 50' && call.globalCompositeOperation === 'lighter'));
});

test('full combo hides the entire playfield but keeps gauge and combo UI', () => {
  const context = new RecordingContext();
  const canvas = {
    width: 1280, height: 720,
    getContext: (kind: string) => kind === '2d' ? context : null,
  };
  renderFrame(canvas, chart(), 3.5,
    { gameX: 0.5, gameY: 0.68, gameWidth: 0.58, gameHeight: 0.55 },
    null, { mode: 'autoplay' });

  assert.equal(context.calls.some((call) => call.name === 'moveTo'), false);
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === '4 COMBO'));
  assert(context.calls.some((call) => call.name === 'fillText' && call.args[0] === 'FULL COMBO'));
  assert(context.calls.some((call) => call.name === 'fillRect'));
});
