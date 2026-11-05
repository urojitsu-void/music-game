export type ChartDifficulty = 'easy' | 'normal' | 'hard';
export const MIN_SAME_LANE_INTERVAL_SECONDS = 0.25;

interface ChartNoteBase {
  readonly time: number;
  readonly lane: number;
}

export interface TapNote extends ChartNoteBase { readonly type: 'tap' }
export interface HoldNote extends ChartNoteBase { readonly type: 'hold'; readonly duration: number }
export interface FlickNote extends ChartNoteBase {
  readonly type: 'flick';
  readonly direction: 'left' | 'right' | 'up' | 'down';
}
export type ChartNote = TapNote | HoldNote | FlickNote;

type StatisticValue = null | boolean | number | string
  | readonly StatisticValue[] | { readonly [key: string]: StatisticValue };

export interface Chart {
  readonly formatVersion: 1;
  readonly audio: string;
  readonly duration: number;
  readonly bpm: number;
  readonly beatOffset: number;
  readonly beatsPerBar: 4;
  readonly difficulty: ChartDifficulty;
  readonly lanes: 4;
  readonly seed: number;
  readonly notes: readonly ChartNote[];
  readonly statistics: Readonly<Record<string, StatisticValue>>;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function statistic(value: unknown, path: string): StatisticValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => statistic(item, `${path}[${index}]`));
  const object = record(value, path);
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, statistic(object[key], `${path}.${key}`)]),
  );
}

export function validateChart(value: unknown): Chart {
  const input = record(value, 'chart');
  if (input.formatVersion !== 1) throw new RangeError('chart.formatVersion must be 1');
  if (typeof input.audio !== 'string' || input.audio.length === 0) {
    throw new TypeError('chart.audio must be a non-empty string');
  }
  const duration = finite(input.duration, 'chart.duration');
  if (duration <= 0) throw new RangeError('chart.duration must be greater than 0');
  const bpm = finite(input.bpm, 'chart.bpm');
  if (bpm < 40 || bpm > 250) throw new RangeError('chart.bpm must be between 40 and 250');
  const beatOffset = finite(input.beatOffset, 'chart.beatOffset');
  if (beatOffset < 0) throw new RangeError('chart.beatOffset must be nonnegative');
  if (input.beatsPerBar !== 4) throw new RangeError('chart.beatsPerBar must be 4');
  if (input.difficulty !== 'easy' && input.difficulty !== 'normal' && input.difficulty !== 'hard') {
    throw new TypeError('chart.difficulty must be easy, normal, or hard');
  }
  if (input.lanes !== 4) throw new RangeError('chart.lanes must be 4');
  if (!Number.isSafeInteger(input.seed)) throw new TypeError('chart.seed must be a safe integer');
  if (!Array.isArray(input.notes)) throw new TypeError('chart.notes must be an array');

  const notes: ChartNote[] = [];
  const holdEnds = [-Infinity, -Infinity, -Infinity, -Infinity];
  const previousLaneTimes = [-Infinity, -Infinity, -Infinity, -Infinity];
  let previous: ChartNote | undefined;
  for (let index = 0; index < input.notes.length; index += 1) {
    const path = `chart.notes[${index}]`;
    const note = record(input.notes[index], path);
    const time = finite(note.time, `${path}.time`);
    if (time < 0 || time > duration) throw new RangeError(`${path}.time must be within chart.duration`);
    if (!Number.isInteger(note.lane) || (note.lane as number) < 0 || (note.lane as number) > 3) {
      throw new RangeError(`${path}.lane must be an integer from 0 to 3`);
    }
    let parsed: ChartNote;
    if (note.type === 'tap') {
      parsed = { time, lane: note.lane as number, type: 'tap' };
    } else if (note.type === 'hold') {
      const noteDuration = finite(note.duration, `${path}.duration`);
      if (noteDuration <= 0 || time + noteDuration > duration) {
        throw new RangeError(`${path}.duration must be positive and end within chart.duration`);
      }
      parsed = { time, lane: note.lane as number, type: 'hold', duration: noteDuration };
    } else if (note.type === 'flick') {
      if (note.direction !== 'left' && note.direction !== 'right'
        && note.direction !== 'up' && note.direction !== 'down') {
        throw new TypeError(`${path}.direction must be left, right, up, or down`);
      }
      parsed = {
        time, lane: note.lane as number, type: 'flick', direction: note.direction,
      };
    } else {
      throw new TypeError(`${path}.type must be tap, hold, or flick`);
    }
    if (previous && (parsed.time < previous.time
      || (parsed.time === previous.time && parsed.lane < previous.lane))) {
      throw new Error('chart.notes must be sorted by time then lane');
    }
    if (previous && parsed.time === previous.time && parsed.lane === previous.lane) {
      throw new Error(`${path} duplicates the previous time and lane`);
    }
    if (parsed.time < holdEnds[parsed.lane]!) {
      throw new Error(`${path} overlaps an active hold on lane ${parsed.lane}`);
    }
    if (parsed.time - holdEnds[parsed.lane]!
      < MIN_SAME_LANE_INTERVAL_SECONDS - Number.EPSILON) {
      throw new Error(`${path} must be at least 250 milliseconds after the hold ends`);
    }
    if (parsed.time - previousLaneTimes[parsed.lane]!
      < MIN_SAME_LANE_INTERVAL_SECONDS - Number.EPSILON) {
      throw new Error(`${path} must be at least 250 milliseconds after the previous lane note`);
    }
    if (parsed.type === 'hold') holdEnds[parsed.lane] = parsed.time + parsed.duration;
    previousLaneTimes[parsed.lane] = parsed.time;
    notes.push(parsed);
    previous = parsed;
  }

  const statistics = statistic(input.statistics, 'chart.statistics');
  if (statistics === null || Array.isArray(statistics) || typeof statistics !== 'object') {
    throw new TypeError('chart.statistics must be an object');
  }
  return {
    formatVersion: 1,
    audio: input.audio,
    duration,
    bpm,
    beatOffset,
    beatsPerBar: 4,
    difficulty: input.difficulty,
    lanes: 4,
    seed: input.seed as number,
    notes,
    statistics: statistics as Readonly<Record<string, StatisticValue>>,
  };
}
