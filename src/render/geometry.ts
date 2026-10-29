import type { Layout } from '../build/config.ts';

export interface PixelLayout {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly topCenterX: number;
  readonly topY: number;
  readonly topWidth: number;
  readonly judgmentCenterX: number;
  readonly judgmentY: number;
  readonly judgmentWidth: number;
}

export interface ProjectedNote {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export function resolveLayout(
  layout: Layout, canvasWidth: number, canvasHeight: number,
): PixelLayout {
  const judgmentWidth = layout.gameWidth * canvasWidth;
  return {
    canvasWidth,
    canvasHeight,
    topCenterX: layout.gameX * canvasWidth,
    topY: (layout.gameY - layout.gameHeight) * canvasHeight,
    topWidth: judgmentWidth * 0.42,
    judgmentCenterX: layout.gameX * canvasWidth,
    judgmentY: layout.gameY * canvasHeight,
    judgmentWidth,
  };
}

function mix(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export function lanePoint(
  layout: PixelLayout, laneBoundary: number, progress: number,
): { readonly x: number; readonly y: number } {
  const topLeft = layout.topCenterX - layout.topWidth / 2;
  const bottomLeft = layout.judgmentCenterX - layout.judgmentWidth / 2;
  const topX = topLeft + layout.topWidth * laneBoundary / 4;
  const bottomX = bottomLeft + layout.judgmentWidth * laneBoundary / 4;
  return {
    x: mix(topX, bottomX, progress),
    y: mix(layout.topY, layout.judgmentY, progress),
  };
}

export function projectNote(
  layout: PixelLayout, lane: number, progress: number,
): ProjectedNote {
  const clamped = Math.max(0, Math.min(1, progress));
  const point = lanePoint(layout, lane + 0.5, clamped);
  const topRadius = Math.max(4, layout.canvasWidth * 0.006);
  const judgmentRadius = Math.max(10, layout.canvasWidth * 0.014);
  return { ...point, radius: mix(topRadius, judgmentRadius, clamped) };
}
