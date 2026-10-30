import type { Layout } from '../build/config.ts';
import type { Chart, ChartNote } from '../chart/schema.ts';
import {
  lanePoint, projectNote, resolveLayout, type ProjectedNote,
} from './geometry.ts';

export interface RenderTheme {
  readonly laneColor: string;
  readonly judgmentColor: string;
  readonly targetColor: string;
  readonly noteColor: string;
  readonly noteOutline: string;
  readonly noteHighlight: string;
  readonly holdColor: string;
  readonly flickColor: string;
  readonly hitColor: string;
  readonly textColor: string;
  readonly textOutline: string;
  readonly gaugeColor: string;
}

export const DEFAULT_THEME: RenderTheme = Object.freeze({
  laneColor: 'rgba(210, 225, 255, 0.42)',
  judgmentColor: 'rgba(255, 255, 255, 0.92)',
  targetColor: 'rgba(125, 220, 255, 0.88)',
  noteColor: '#55d7ff',
  noteOutline: 'rgba(8, 18, 38, 0.92)',
  noteHighlight: 'rgba(255, 255, 255, 0.85)',
  holdColor: '#ff4fd8',
  flickColor: '#ffe45c',
  hitColor: '#ffffff',
  textColor: '#ffffff',
  textOutline: '#05070d',
  gaugeColor: '#67f7ff',
});

export interface RasterAsset { readonly image: unknown; readonly width: number; readonly height: number }
export interface RenderAssets {
  readonly tap: RasterAsset;
  readonly hold: RasterAsset;
  readonly flick: Readonly<Record<'left' | 'right' | 'up' | 'down', RasterAsset>>;
  readonly combo: RasterAsset;
  readonly comboGlow: RasterAsset;
  readonly perfect: RasterAsset;
  readonly fullCombo: RasterAsset;
  readonly gauge: RasterAsset;
  readonly gaugeGlow: RasterAsset;
  readonly hitRing: RasterAsset;
}

export type FrameNote = ChartNote & {
  readonly progress: number;
  readonly endProgress?: number;
};

export type HitState = ChartNote & {
  readonly progress: number;
};

export interface FrameState {
  readonly notes: readonly FrameNote[];
  readonly hits: readonly HitState[];
  readonly combo: number;
  readonly gauge: number;
  readonly hitPulse: number;
  readonly fullComboProgress: number | null;
}

export function comboNumberPalette(combo: number): readonly [string, string, string] {
  if (combo >= 400) return ['#ff8aa4', '#ff1744', '#870019'];
  if (combo >= 200) return ['#fff6a0', '#ffe04b', '#a65a00'];
  if (combo >= 100) return ['#b9ffd5', '#36f58a', '#08743c'];
  if (combo >= 50) return ['#b9f7ff', '#38dfff', '#00688e'];
  return ['#ffffff', '#ffffff', '#7b8296'];
}

export function deriveFrameState(
  chart: Chart,
  timeSeconds: number,
  options: { readonly travelSec?: number; readonly hitEffectSec?: number } = {},
): FrameState {
  const travelSec = options.travelSec ?? 2;
  const hitEffectSec = options.hitEffectSec ?? 0.22;
  const notes: FrameNote[] = [];
  const hits: HitState[] = [];
  let combo = 0;
  for (const note of chart.notes) {
    if (note.time <= timeSeconds) combo += 1;
    const appearance = note.time - travelSec;
    if (note.type === 'hold') {
      const endTime = note.time + note.duration;
      if (timeSeconds >= appearance && timeSeconds < endTime) {
        notes.push({
          ...note,
          progress: Math.min(1, (timeSeconds - appearance) / travelSec),
          endProgress: (timeSeconds - (endTime - travelSec)) / travelSec,
        });
      }
    } else if (timeSeconds >= appearance && timeSeconds < note.time) {
      notes.push({ ...note, progress: (timeSeconds - appearance) / travelSec });
    }
    const elapsed = timeSeconds - note.time;
    if (elapsed >= 0 && elapsed <= hitEffectSec) {
      hits.push({ ...note, progress: elapsed / hitEffectSec });
    }
  }
  const hitPulse = hits.reduce((pulse, hit) => Math.max(pulse, 1 - hit.progress), 0);
  const finalHitTime = chart.notes.reduce((latest, note) => Math.max(
    latest,
    note.type === 'hold' ? note.time + note.duration : note.time,
  ), Number.NEGATIVE_INFINITY);
  const fullComboElapsed = Number.isFinite(finalHitTime) ? timeSeconds - finalHitTime : -1;
  const fullComboProgress = fullComboElapsed >= 0 && fullComboElapsed <= 2.5
    ? fullComboElapsed / 2.5 : null;
  return {
    notes, hits, combo,
    gauge: chart.notes.length === 0 ? 0 : combo / chart.notes.length,
    hitPulse,
    fullComboProgress,
  };
}

interface ContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  clearRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  createRadialGradient(
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
  ): CanvasGradient;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  drawImage(image: unknown, ...args: number[]): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  save(): void;
  restore(): void;
}

export interface CanvasLike {
  readonly width: number;
  readonly height: number;
  getContext(kind: '2d'): ContextLike | null;
}

function circle(context: ContextLike, point: ProjectedNote, radius = point.radius): void {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
}

function drawDisc(
  context: ContextLike, point: ProjectedNote, color: string, theme: RenderTheme,
): void {
  context.save();
  context.globalAlpha = 0.35;
  context.strokeStyle = color;
  context.lineWidth = Math.max(3, point.radius * 0.32);
  circle(context, point, point.radius * 1.38);
  context.stroke();
  context.globalAlpha = 1;
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  context.lineWidth = Math.max(2, point.radius * 0.16);
  circle(context, point, point.radius * 1.22);
  context.stroke();
  const gradient = context.createRadialGradient(
    point.x - point.radius * 0.32,
    point.y - point.radius * 0.38,
    Math.max(1, point.radius * 0.06),
    point.x,
    point.y,
    point.radius,
  );
  const edgeColor = color === theme.holdColor
    ? '#7b0f68' : color === theme.flickColor ? '#a66500' : '#08779d';
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.2, theme.noteHighlight);
  gradient.addColorStop(0.58, color);
  gradient.addColorStop(1, edgeColor);
  context.fillStyle = gradient;
  context.strokeStyle = theme.noteOutline;
  context.lineWidth = Math.max(2, point.radius * 0.22);
  circle(context, point);
  context.fill();
  context.stroke();
  context.fillStyle = theme.noteHighlight;
  circle(context, {
    x: point.x - point.radius * 0.2,
    y: point.y - point.radius * 0.2,
    radius: point.radius * 0.3,
  });
  context.fill();
  context.restore();
}

function drawFlick(
  context: ContextLike, point: ProjectedNote,
  direction: 'left' | 'right' | 'up' | 'down', theme: RenderTheme,
): void {
  drawDisc(context, point, theme.flickColor, theme);
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  context.strokeStyle = theme.noteOutline;
  context.lineWidth = Math.max(3, point.radius * 0.24);
  context.beginPath();
  context.moveTo(point.x + (horizontal ? -sign * point.radius * 0.35 : -point.radius * 0.48), point.y + (horizontal ? -point.radius * 0.48 : -sign * point.radius * 0.35));
  context.lineTo(point.x + (horizontal ? sign * point.radius * 0.35 : 0), point.y + (horizontal ? 0 : sign * point.radius * 0.35));
  context.lineTo(point.x + (horizontal ? -sign * point.radius * 0.35 : point.radius * 0.48), point.y + (horizontal ? point.radius * 0.48 : -sign * point.radius * 0.35));
  context.stroke();
}

function drawAsset(context: ContextLike, asset: RasterAsset, x: number, y: number, width: number): void {
  const height = width * asset.height / asset.width;
  context.drawImage(asset.image, x - width / 2, y - height / 2, width, height);
}

function drawRotatedAsset(
  context: ContextLike, asset: RasterAsset, x: number, y: number, width: number, angle: number,
): void {
  const height = width * asset.height / asset.width;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.drawImage(asset.image, -width / 2, -height / 2, width, height);
  context.restore();
}

function drawNote(
  context: ContextLike, note: FrameNote, point: ProjectedNote,
  layout: ReturnType<typeof resolveLayout>, theme: RenderTheme, assets?: RenderAssets,
): void {
  if (note.type === 'hold') {
    const tail = projectNote(layout, note.lane, note.endProgress ?? note.progress);
    context.strokeStyle = 'rgba(255, 79, 216, 0.72)';
    context.lineWidth = Math.max(point.radius * 1.2, 8);
    context.beginPath();
    context.moveTo(tail.x, tail.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    if (assets) {
      drawAsset(context, assets.hold, tail.x, tail.y, tail.radius * 4.2);
      drawAsset(context, assets.hold, point.x, point.y, point.radius * 4.2);
    } else {
      drawDisc(context, tail, theme.holdColor, theme);
      drawDisc(context, point, theme.holdColor, theme);
    }
  } else if (note.type === 'flick') {
    if (assets) drawAsset(context, assets.flick[note.direction], point.x, point.y, point.radius * 4.4);
    else drawFlick(context, point, note.direction, theme);
  } else {
    if (assets) drawAsset(context, assets.tap, point.x, point.y, point.radius * 4.2);
    else drawDisc(context, point, theme.noteColor, theme);
  }
}

export function renderFrame(
  canvas: CanvasLike,
  chart: Chart,
  timeSeconds: number,
  normalizedLayout: Layout,
  theme: RenderTheme | null,
  playState: { readonly mode: 'autoplay' },
  assets?: RenderAssets,
): FrameState {
  if (playState.mode !== 'autoplay') throw new Error('Only autoplay rendering is supported');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  const colors = theme ?? DEFAULT_THEME;
  const layout = resolveLayout(normalizedLayout, canvas.width, canvas.height);
  const state = deriveFrameState(chart, timeSeconds);
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (state.fullComboProgress === null) {
    for (let lane = 0; lane < 4; lane += 1) {
      const topLeft = lanePoint(layout, lane, 0);
      const topRight = lanePoint(layout, lane + 1, 0);
      const bottomRight = lanePoint(layout, lane + 1, 1);
      const bottomLeft = lanePoint(layout, lane, 1);
      context.fillStyle = 'rgba(255, 255, 255, 0.035)';
      context.beginPath();
      context.moveTo(topLeft.x, topLeft.y);
      context.lineTo(topRight.x, topRight.y);
      context.lineTo(bottomRight.x, bottomRight.y);
      context.lineTo(bottomLeft.x, bottomLeft.y);
      context.lineTo(topLeft.x, topLeft.y);
      context.fill();
    }
    context.lineWidth = Math.max(2, canvas.width / 640);
    for (let lane = 0; lane < 4; lane += 1) {
      const top = lanePoint(layout, lane + 0.5, 0);
      const bottom = lanePoint(layout, lane + 0.5, 1);
      const railColor = 'rgba(255, 255, 255, 0.82)';
      context.save();
      context.strokeStyle = railColor;
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(bottom.x, bottom.y);
      context.stroke();
      context.restore();
    }
    const judgmentLeft = lanePoint(layout, 0, 1);
    const judgmentRight = lanePoint(layout, 4, 1);
    context.strokeStyle = colors.judgmentColor;
    context.lineWidth = Math.max(2, canvas.width / 500);
    context.save();
    context.beginPath();
    context.moveTo(judgmentLeft.x, judgmentLeft.y);
    context.lineTo(judgmentRight.x, judgmentRight.y);
    context.stroke();
    context.restore();

    for (let lane = 0; lane < 4; lane += 1) {
      const target = projectNote(layout, lane, 1);
      context.strokeStyle = colors.targetColor;
      context.lineWidth = Math.max(2, target.radius * 0.16);
      context.save();
      const pulse = 1.12 + Math.sin(timeSeconds * 7 + lane * 0.8) * 0.1;
      circle(context, target, target.radius * pulse);
      context.stroke();
      circle(context, target, target.radius * 0.62);
      context.stroke();
      context.restore();
    }
    for (const note of state.notes) {
      drawNote(context, note, projectNote(layout, note.lane, note.progress), layout, colors, assets);
    }
    for (const hit of state.hits) {
      const point = projectNote(layout, hit.lane, 1);
      context.save();
      context.globalAlpha = 1 - hit.progress;
      if (assets) {
        const size = point.radius * (6 + hit.progress * 8);
        for (let layer = 0; layer < 3; layer += 1) {
          context.globalAlpha = (1 - hit.progress) * (1 - layer * 0.18);
          drawRotatedAsset(context, assets.hitRing, point.x, point.y,
            size * (1 - layer * 0.19), hit.progress * Math.PI * (2.4 + layer) + layer * 0.72);
        }
        context.globalAlpha = 1 - hit.progress;
      }
      else {
        context.strokeStyle = colors.hitColor;
        context.lineWidth = Math.max(2, point.radius * 0.18);
        circle(context, point, point.radius * (1.2 + hit.progress * 1.8));
        context.stroke();
      }
      context.strokeStyle = colors.textOutline;
      context.lineWidth = Math.max(5, canvas.height * 0.008);
      context.font = `900 ${Math.max(24, canvas.height * 0.052)}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const perfectY = point.y - point.radius * 3.4;
      if (assets) {
        const perfectScale = 1 + (1 - hit.progress) * 0.32;
        drawAsset(context, assets.perfect, point.x, perfectY, canvas.width * 0.19 * perfectScale);
      }
      else {
        context.strokeText('PERFECT', point.x, perfectY);
        context.fillStyle = colors.flickColor;
        context.fillText('PERFECT', point.x, perfectY);
      }
      context.restore();
    }
  }
  const gaugeWidth = canvas.width * 0.36;
  const gaugeHeight = Math.max(20, canvas.height * 0.032);
  const gaugeX = layout.judgmentCenterX - gaugeWidth / 2;
  const gaugeY = canvas.height * 0.025;
  context.fillStyle = 'rgba(5, 7, 13, 0.78)';
  context.fillRect(gaugeX - 4, gaugeY - 4, gaugeWidth + 8, gaugeHeight + 8);
  if (assets && state.gauge > 0) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = 0.82;
    context.drawImage(assets.gaugeGlow.image, 0, 0,
      assets.gaugeGlow.width * state.gauge, assets.gaugeGlow.height,
      gaugeX, gaugeY - gaugeHeight * 2.25, gaugeWidth * state.gauge, gaugeHeight * 5.5);
    context.restore();
    context.drawImage(assets.gauge.image, 0, 0, assets.gauge.width * state.gauge, assets.gauge.height,
      gaugeX, gaugeY, gaugeWidth * state.gauge, gaugeHeight);
  } else {
    context.fillStyle = colors.gaugeColor;
    context.fillRect(gaugeX, gaugeY, gaugeWidth * state.gauge, gaugeHeight);
  }
  const ranks = ['D', 'C', 'B', 'A', 'S'] as const;
  context.font = `900 ${Math.max(16, gaugeHeight * 0.72)}px "Avenir Next", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = Math.max(2, gaugeHeight * 0.18);
  for (let index = 0; index < ranks.length; index += 1) {
    const threshold = (index + 1) / ranks.length;
    const x = gaugeX + gaugeWidth * (index + 0.5) / ranks.length;
    context.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    context.fillStyle = state.gauge >= threshold - 0.2 ? '#ffffff' : 'rgba(255,255,255,0.78)';
    context.strokeText(ranks[index]!, x, gaugeY + gaugeHeight / 2);
    context.fillText(ranks[index]!, x, gaugeY + gaugeHeight / 2);
    if (index < ranks.length - 1) {
      context.fillStyle = 'rgba(255,255,255,0.72)';
      context.fillRect(gaugeX + gaugeWidth * (index + 1) / ranks.length - 1,
        gaugeY, 2, gaugeHeight);
    }
  }
  if (state.combo > 0) {
    const bounce = 1 + state.hitPulse * 0.28;
    const comboY = gaugeY + gaugeHeight + canvas.height * 0.052;
    const palette = comboNumberPalette(state.combo);
    const numberGradient = context.createLinearGradient(0, comboY - canvas.height * 0.04, 0, comboY + canvas.height * 0.04);
    numberGradient.addColorStop(0, palette[0]); numberGradient.addColorStop(0.48, palette[1]); numberGradient.addColorStop(1, palette[2]);
    context.fillStyle = numberGradient;
    context.strokeStyle = colors.textOutline;
    context.lineWidth = Math.max(6, canvas.height * 0.011);
    context.font = `900 ${Math.max(20, canvas.height * 0.045) * bounce}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const comboText = assets ? `${state.combo}` : `${state.combo} COMBO`;
    const numberX = assets ? layout.judgmentCenterX - canvas.width * 0.075 : layout.judgmentCenterX;
    context.strokeText(comboText, numberX, comboY);
    context.fillText(comboText, numberX, comboY);
    if (assets) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = 0.78;
      drawAsset(context, assets.comboGlow, layout.judgmentCenterX + canvas.width * 0.055,
        comboY, canvas.width * 0.22 * bounce);
      context.restore();
      drawAsset(context, assets.combo, layout.judgmentCenterX + canvas.width * 0.055,
        comboY, canvas.width * 0.17 * bounce);
    }
  }
  if (state.fullComboProgress !== null) {
    const entrance = Math.min(1, state.fullComboProgress * 8);
    const scale = 0.72 + entrance * 0.28
      + Math.sin(state.fullComboProgress * Math.PI * 8) * (1 - entrance) * 0.08;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `900 ${canvas.height * 0.105 * scale}px sans-serif`;
    context.strokeStyle = colors.textOutline;
    context.lineWidth = Math.max(10, canvas.height * 0.018);
    context.fillStyle = colors.flickColor;
    const fullComboY = canvas.height * 0.4;
    if (assets) drawAsset(context, assets.fullCombo, layout.judgmentCenterX, fullComboY, canvas.width * 0.58 * scale);
    else {
      context.strokeText('FULL COMBO', layout.judgmentCenterX, fullComboY);
      context.fillText('FULL COMBO', layout.judgmentCenterX, fullComboY);
    }
  }
  return state;
}
