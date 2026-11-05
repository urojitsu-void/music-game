import type { FlickDirection } from './game-events.ts';

export interface HorizontalRect {
  readonly left: number;
  readonly width: number;
}

export interface PointerEventData {
  readonly type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
  readonly rect: HorizontalRect;
}

export interface PointerGameAction {
  readonly action: 'press' | 'release' | 'flick';
  readonly lane: number;
  readonly direction?: FlickDirection;
  readonly timeMs: number;
  readonly pointerId: number;
}

export interface PointerInputTranslator {
  handle(event: PointerEventData): readonly PointerGameAction[];
}

interface ActivePointer {
  readonly lane: number;
  readonly startX: number;
  readonly startY: number;
}

export function laneFromClientX(x: number, rect: HorizontalRect): number | null {
  if (rect.width <= 0 || x < rect.left || x >= rect.left + rect.width) return null;
  return Math.min(3, Math.floor(((x - rect.left) / rect.width) * 4));
}

function flickDirection(
  deltaX: number,
  deltaY: number,
  thresholdPx: number,
  dominanceRatio: number,
): FlickDirection | null {
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);
  const major = Math.max(absoluteX, absoluteY);
  const minor = Math.min(absoluteX, absoluteY);
  if (major < thresholdPx || major < minor * dominanceRatio) return null;
  if (absoluteX > absoluteY) return deltaX < 0 ? 'left' : 'right';
  return deltaY < 0 ? 'up' : 'down';
}

export function createPointerInputTranslator(options: {
  readonly thresholdPx?: number;
  readonly dominanceRatio?: number;
} = {}): PointerInputTranslator {
  const thresholdPx = options.thresholdPx ?? 24;
  const dominanceRatio = options.dominanceRatio ?? 1.25;
  const activePointers = new Map<number, ActivePointer>();

  function handle(event: PointerEventData): readonly PointerGameAction[] {
    if (event.type === 'pointerdown') {
      if (activePointers.has(event.pointerId)) return [];
      const lane = laneFromClientX(event.x, event.rect);
      if (lane === null) return [];
      activePointers.set(event.pointerId, {
        lane, startX: event.x, startY: event.y,
      });
      return [{
        action: 'press', lane, timeMs: event.timeMs, pointerId: event.pointerId,
      }];
    }

    const active = activePointers.get(event.pointerId);
    if (!active) return [];

    if (event.type === 'pointermove') {
      const direction = flickDirection(
        event.x - active.startX,
        event.y - active.startY,
        thresholdPx,
        dominanceRatio,
      );
      if (!direction) return [];
      activePointers.delete(event.pointerId);
      return [{
        action: 'flick',
        lane: active.lane,
        direction,
        timeMs: event.timeMs,
        pointerId: event.pointerId,
      }];
    }

    activePointers.delete(event.pointerId);
    return [{
      action: 'release',
      lane: active.lane,
      timeMs: event.timeMs,
      pointerId: event.pointerId,
    }];
  }

  return { handle };
}
