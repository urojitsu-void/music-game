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
  readonly hitColor: string;
  readonly textColor: string;
}

export const DEFAULT_THEME: RenderTheme = Object.freeze({
  laneColor: 'rgba(210, 225, 255, 0.42)',
  judgmentColor: 'rgba(255, 255, 255, 0.92)',
  targetColor: 'rgba(125, 220, 255, 0.88)',
  noteColor: '#55d7ff',
  noteOutline: 'rgba(8, 18, 38, 0.92)',
  noteHighlight: 'rgba(255, 255, 255, 0.85)',
  hitColor: '#ffffff',
  textColor: '#ffffff',
});

export interface FrameNote extends ChartNote {
  readonly progress: number;
}

export interface HitState extends ChartNote {
  readonly progress: number;
}

export interface FrameState {
  readonly notes: readonly FrameNote[];
  readonly hits: readonly HitState[];
  readonly combo: number;
}

export function deriveFrameState(
  chart: Chart,
  timeSeconds: number,
  options: { readonly travelSec?: number; readonly hitEffectSec?: number } = {},
): FrameState {
  const travelSec = options.travelSec ?? 2;
  const hitEffectSec = options.hitEffectSec ?? 0.12;
  const notes: FrameNote[] = [];
  const hits: HitState[] = [];
  let combo = 0;
  for (const note of chart.notes) {
    if (note.time <= timeSeconds) combo += 1;
    const appearance = note.time - travelSec;
    if (timeSeconds >= appearance && timeSeconds < note.time) {
      notes.push({ ...note, progress: (timeSeconds - appearance) / travelSec });
    }
    const elapsed = timeSeconds - note.time;
    if (elapsed >= 0 && elapsed <= hitEffectSec) {
      hits.push({ ...note, progress: elapsed / hitEffectSec });
    }
  }
  return { notes, hits, combo };
}

interface ContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
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

function drawNote(context: ContextLike, point: ProjectedNote, theme: RenderTheme): void {
  context.fillStyle = theme.noteColor;
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
}

export function renderFrame(
  canvas: CanvasLike,
  chart: Chart,
  timeSeconds: number,
  normalizedLayout: Layout,
  theme: RenderTheme | null,
  playState: { readonly mode: 'autoplay' },
): FrameState {
  if (playState.mode !== 'autoplay') throw new Error('Only autoplay rendering is supported');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  const colors = theme ?? DEFAULT_THEME;
  const layout = resolveLayout(normalizedLayout, canvas.width, canvas.height);
  const state = deriveFrameState(chart, timeSeconds);
  context.clearRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = colors.laneColor;
  context.lineWidth = Math.max(1, canvas.width / 900);
  for (let boundary = 0; boundary <= 4; boundary += 1) {
    const top = lanePoint(layout, boundary, 0);
    const bottom = lanePoint(layout, boundary, 1);
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(bottom.x, bottom.y);
    context.stroke();
  }
  const judgmentLeft = lanePoint(layout, 0, 1);
  const judgmentRight = lanePoint(layout, 4, 1);
  context.strokeStyle = colors.judgmentColor;
  context.lineWidth = Math.max(2, canvas.width / 500);
  context.beginPath();
  context.moveTo(judgmentLeft.x, judgmentLeft.y);
  context.lineTo(judgmentRight.x, judgmentRight.y);
  context.stroke();

  for (let lane = 0; lane < 4; lane += 1) {
    const target = projectNote(layout, lane, 1);
    context.strokeStyle = colors.targetColor;
    context.lineWidth = Math.max(2, target.radius * 0.16);
    circle(context, target, target.radius * 1.12);
    context.stroke();
  }
  for (const note of state.notes) drawNote(context, projectNote(layout, note.lane, note.progress), colors);
  for (const hit of state.hits) {
    const point = projectNote(layout, hit.lane, 1);
    context.save();
    context.globalAlpha = 1 - hit.progress;
    context.strokeStyle = colors.hitColor;
    context.lineWidth = Math.max(2, point.radius * 0.18);
    circle(context, point, point.radius * (1.2 + hit.progress * 1.8));
    context.stroke();
    context.restore();
  }
  if (state.combo > 0) {
    context.fillStyle = colors.textColor;
    context.font = `700 ${Math.max(20, canvas.height * 0.045)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${state.combo} COMBO`, layout.judgmentCenterX, layout.topY - canvas.height * 0.05);
  }
  return state;
}
