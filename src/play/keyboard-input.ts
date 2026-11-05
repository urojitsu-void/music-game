import type { FlickDirection } from './game-events.ts';

export interface KeyboardEventData {
  readonly type: 'keydown' | 'keyup';
  readonly key: string;
  readonly repeat: boolean;
  readonly timeMs: number;
}

export interface KeyboardGameAction {
  readonly action: 'press' | 'release' | 'flick';
  readonly lane: number;
  readonly direction?: FlickDirection;
  readonly timeMs: number;
}

export interface KeyboardInputTranslator {
  handle(event: KeyboardEventData): readonly KeyboardGameAction[];
  flush(timeMs: number): readonly KeyboardGameAction[];
}

const LANE_KEYS: Readonly<Record<string, number>> = Object.freeze({
  a: 0,
  s: 1,
  d: 2,
  f: 3,
});

const ARROW_KEYS: Readonly<Record<string, FlickDirection>> = Object.freeze({
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
});

const DEFAULT_CHORD_WINDOW_MS = 100;

export function shouldPreventGameKeyDefault(key: string, gameActive: boolean): boolean {
  return gameActive && Object.hasOwn(ARROW_KEYS, key);
}

export function createKeyboardInputTranslator(
  chordWindowMs = DEFAULT_CHORD_WINDOW_MS,
): KeyboardInputTranslator {
  const pendingLanes = new Map<number, number>();
  const pressedLanes = new Set<number>();
  const chordedLanes = new Set<number>();
  let recentDirection: { readonly direction: FlickDirection; readonly timeMs: number } | null = null;

  function flush(timeMs: number): readonly KeyboardGameAction[] {
    const actions: KeyboardGameAction[] = [];
    for (const [lane, pressedAt] of pendingLanes) {
      if (timeMs - pressedAt <= chordWindowMs) continue;
      pendingLanes.delete(lane);
      pressedLanes.add(lane);
      actions.push({ action: 'press', lane, timeMs: pressedAt });
    }
    if (recentDirection && timeMs - recentDirection.timeMs > chordWindowMs) {
      recentDirection = null;
    }
    return actions;
  }

  function handle(event: KeyboardEventData): readonly KeyboardGameAction[] {
    if (event.repeat) return [];
    const actions = [...flush(event.timeMs)];
    const normalizedKey = event.key.toLowerCase();
    const lane = LANE_KEYS[normalizedKey];
    const direction = ARROW_KEYS[event.key];

    if (direction) {
      if (event.type === 'keyup') return actions;
      recentDirection = { direction, timeMs: event.timeMs };
      for (const [pendingLane, pressedAt] of pendingLanes) {
        if (event.timeMs - pressedAt > chordWindowMs) continue;
        pendingLanes.delete(pendingLane);
        chordedLanes.add(pendingLane);
        actions.push({
          action: 'flick',
          lane: pendingLane,
          direction,
          timeMs: pressedAt,
        });
      }
      return actions;
    }

    if (lane === undefined) return actions;
    if (event.type === 'keydown') {
      if (pendingLanes.has(lane) || pressedLanes.has(lane) || chordedLanes.has(lane)) {
        return actions;
      }
      if (recentDirection && event.timeMs - recentDirection.timeMs <= chordWindowMs) {
        chordedLanes.add(lane);
        actions.push({
          action: 'flick',
          lane,
          direction: recentDirection.direction,
          timeMs: event.timeMs,
        });
      } else {
        pendingLanes.set(lane, event.timeMs);
      }
      return actions;
    }

    if (chordedLanes.delete(lane)) return actions;
    const pendingAt = pendingLanes.get(lane);
    if (pendingAt !== undefined) {
      pendingLanes.delete(lane);
      actions.push({ action: 'press', lane, timeMs: pendingAt });
      actions.push({ action: 'release', lane, timeMs: event.timeMs });
      return actions;
    }
    if (pressedLanes.delete(lane)) {
      actions.push({ action: 'release', lane, timeMs: event.timeMs });
    }
    return actions;
  }

  return { handle, flush };
}
