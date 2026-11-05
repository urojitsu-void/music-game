import type { Chart } from '../chart/schema.ts';
import {
  expandChartEvents, type FlickDirection, type GameEvent,
} from './game-events.ts';

export type Judgment = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'MISS';
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';

export interface GameInput {
  readonly action: 'press' | 'release' | 'flick';
  readonly lane: number;
  readonly time: number;
  readonly direction?: FlickDirection;
}

export interface JudgmentRecord {
  readonly eventId: string;
  readonly judgment: Judgment;
  readonly time: number;
  readonly timingOffset: number;
}

export interface JudgmentCounts {
  readonly PERFECT: number;
  readonly GREAT: number;
  readonly GOOD: number;
  readonly BAD: number;
  readonly MISS: number;
}

export interface GameSnapshot {
  readonly currentTime: number;
  readonly score: number;
  readonly maxScore: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly gauge: number;
  readonly rank: Rank;
  readonly completed: boolean;
  readonly fullCombo: boolean;
  readonly counts: JudgmentCounts;
  readonly judgments: readonly JudgmentRecord[];
  readonly unresolvedEventIds: readonly string[];
}

export interface GameEngine {
  readonly snapshot: GameSnapshot;
  advance(time: number): void;
  input(input: GameInput): JudgmentRecord | null;
}

const SCORE: Readonly<Record<Judgment, number>> = Object.freeze({
  PERFECT: 1_000,
  GREAT: 700,
  GOOD: 300,
  BAD: 100,
  MISS: 0,
});

const BAD_WINDOW_SECONDS = 0.22;
const TIMING_EPSILON = 1e-9;

export function judgeTiming(offsetSeconds: number): Judgment {
  const absolute = Math.abs(offsetSeconds);
  if (absolute <= 0.05 + TIMING_EPSILON) return 'PERFECT';
  if (absolute <= 0.1 + TIMING_EPSILON) return 'GREAT';
  if (absolute <= 0.15 + TIMING_EPSILON) return 'GOOD';
  if (absolute <= BAD_WINDOW_SECONDS + TIMING_EPSILON) return 'BAD';
  return 'MISS';
}

export function rankForScore(score: number, maxScore: number): Rank {
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  if (ratio >= 0.8) return 'S';
  if (ratio >= 0.7) return 'A';
  if (ratio >= 0.6) return 'B';
  if (ratio >= 0.5) return 'C';
  return 'D';
}

function compatible(event: GameEvent, input: GameInput, activeHolds: ReadonlySet<number>): boolean {
  if (event.lane !== input.lane) return false;
  if (input.action === 'press') return event.kind === 'tap' || event.kind === 'hold-start';
  if (input.action === 'flick') return event.kind === 'flick';
  return event.kind === 'hold-end' && activeHolds.has(event.noteIndex);
}

export function createGameEngine(chart: Chart): GameEngine {
  const events = expandChartEvents(chart);
  const unresolved = new Map(events.map((event) => [event.id, event]));
  const activeHolds = new Set<number>();
  const judgments: JudgmentRecord[] = [];
  const counts: Record<Judgment, number> = {
    PERFECT: 0, GREAT: 0, GOOD: 0, BAD: 0, MISS: 0,
  };
  const maxScore = events.length * SCORE.PERFECT;
  let currentTime = 0;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;

  function record(event: GameEvent, judgment: Judgment, time: number): JudgmentRecord {
    unresolved.delete(event.id);
    if (event.kind === 'hold-start' && judgment !== 'MISS') activeHolds.add(event.noteIndex);
    if (event.kind === 'hold-end') activeHolds.delete(event.noteIndex);
    score += SCORE[judgment];
    counts[judgment] += 1;
    if (judgment === 'PERFECT' || judgment === 'GREAT') {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
    } else {
      combo = 0;
    }
    const result: JudgmentRecord = {
      eventId: event.id,
      judgment,
      time,
      timingOffset: time - event.time,
    };
    judgments.push(result);
    return result;
  }

  function advance(time: number): void {
    currentTime = time;
    for (const event of events) {
      if (!unresolved.has(event.id)) continue;
      if (time - event.time > BAD_WINDOW_SECONDS + TIMING_EPSILON) {
        record(event, 'MISS', event.time + BAD_WINDOW_SECONDS);
      }
    }
  }

  function input(gameInput: GameInput): JudgmentRecord | null {
    advance(gameInput.time);
    let target: GameEvent | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const event of unresolved.values()) {
      if (!compatible(event, gameInput, activeHolds)) continue;
      const distance = Math.abs(gameInput.time - event.time);
      if (distance < nearestDistance) {
        target = event;
        nearestDistance = distance;
      }
    }
    if (!target) return null;
    const earlyHoldRelease = gameInput.action === 'release' && gameInput.time < target.time;
    if (nearestDistance > BAD_WINDOW_SECONDS + TIMING_EPSILON && !earlyHoldRelease) return null;
    const timingJudgment = judgeTiming(gameInput.time - target.time);
    const judgment = earlyHoldRelease
      || (target.kind === 'flick' && gameInput.direction !== target.direction)
      ? 'BAD' : timingJudgment;
    return record(target, judgment, gameInput.time);
  }

  return {
    advance,
    input,
    get snapshot(): GameSnapshot {
      const completed = unresolved.size === 0;
      return {
        currentTime,
        score,
        maxScore,
        combo,
        maxCombo,
        gauge: maxScore === 0 ? 0 : score / maxScore,
        rank: rankForScore(score, maxScore),
        completed,
        fullCombo: completed && counts.GOOD === 0 && counts.BAD === 0 && counts.MISS === 0,
        counts: { ...counts },
        judgments: [...judgments],
        unresolvedEventIds: [...unresolved.keys()],
      };
    },
  };
}
