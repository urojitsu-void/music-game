import {
  createGridEvents, type AudioAnalysis, type TempoEstimate,
} from './audio-analysis.ts';
import {
  MIN_SAME_LANE_INTERVAL_SECONDS, validateChart,
  type Chart, type ChartDifficulty, type ChartNote,
} from './schema.ts';

interface DifficultyConfig {
  readonly subdivision: number;
  readonly eventStep: number;
  readonly chords: boolean;
  readonly specialNotes: boolean;
}

const DIFFICULTIES: Readonly<Record<ChartDifficulty, DifficultyConfig>> = {
  easy: { subdivision: 2, eventStep: 1, chords: false, specialNotes: false },
  normal: { subdivision: 4, eventStep: 1, chords: false, specialNotes: true },
  hard: { subdivision: 4, eventStep: 1, chords: true, specialNotes: true },
};

export interface GenerateChartOptions {
  readonly analysis: AudioAnalysis;
  readonly tempo: TempoEstimate;
  readonly audioName: string;
  readonly difficulty: ChartDifficulty;
  readonly lanes?: 4;
  readonly seed?: number;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function chooseLane(
  counts: readonly number[], previousLane: number, nextRandom: () => number,
  availableLanes: readonly number[],
): number | undefined {
  const candidates = availableLanes.map((lane) => ({
    lane,
    cost: counts[lane]! * 10 + (lane === previousLane ? 2 : 0) + nextRandom(),
  }));
  candidates.sort((left, right) => left.cost - right.cost);
  return candidates[0]?.lane;
}

export function generateChart(options: GenerateChartOptions): Chart {
  const lanes = options.lanes ?? 4;
  const seed = options.seed ?? 12345;
  if (lanes !== 4) throw new RangeError('lanes must be 4');
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
  const config = DIFFICULTIES[options.difficulty];
  const events = createGridEvents(options.analysis, options.tempo, config.subdivision)
    .filter((_, index) => index % config.eventStep === 0);
  const nextRandom = random(seed);
  const counts = Array.from({ length: lanes }, () => 0);
  const laneAvailableAt = Array.from({ length: lanes }, () => 0);
  const notes: ChartNote[] = [];
  let previousLane = -1;

  const beatDuration = 60 / options.tempo.bpm;
  for (const event of events) {
    const noteTime = round(event.time);
    const availableLanes = laneAvailableAt
      .map((availableAt, lane) => ({ availableAt, lane }))
      .filter(({ availableAt }) => noteTime >= availableAt - Number.EPSILON)
      .map(({ lane }) => lane);
    const lane = chooseLane(counts, previousLane, nextRandom, availableLanes);
    if (lane === undefined) continue;
    counts[lane]! += 1;
    const strongBeat = event.index % config.subdivision === 0;
    const holdDuration = Math.min(
      beatDuration * (options.difficulty === 'hard' ? 2 : 1),
      options.analysis.duration - event.time,
    );
    if (config.specialNotes && strongBeat
      && event.index % (config.subdivision * 4) === 0 && holdDuration >= beatDuration * 0.75) {
      const duration = round(holdDuration);
      notes.push({ time: noteTime, lane, type: 'hold', duration });
      laneAvailableAt[lane] = Math.max(
        noteTime + MIN_SAME_LANE_INTERVAL_SECONDS,
        noteTime + duration,
      );
    } else if (config.specialNotes && event.band === 2) {
      const directions = ['left', 'up', 'right', 'down'] as const;
      notes.push({
        time: noteTime, lane, type: 'flick',
        direction: directions[Math.abs(event.index) % directions.length]!,
      });
    } else {
      notes.push({ time: noteTime, lane, type: 'tap' });
    }
    laneAvailableAt[lane] = Math.max(
      laneAvailableAt[lane]!, noteTime + MIN_SAME_LANE_INTERVAL_SECONDS,
    );
    previousLane = lane;

    if (config.chords && strongBeat && event.strength >= 2.5) {
      const other = chooseLane(
        counts,
        lane,
        nextRandom,
        availableLanes.filter((candidate) => candidate !== lane),
      );
      if (other === undefined) continue;
      counts[other]! += 1;
      notes.push({ time: noteTime, lane: other, type: 'tap' });
      laneAvailableAt[other] = noteTime + MIN_SAME_LANE_INTERVAL_SECONDS;
    }
  }
  notes.sort((left, right) => left.time - right.time || left.lane - right.lane);

  return validateChart({
    formatVersion: 1,
    audio: options.audioName,
    duration: round(options.analysis.duration),
    bpm: options.tempo.bpm,
    beatOffset: round(options.tempo.offset, 4),
    beatsPerBar: 4,
    difficulty: options.difficulty,
    lanes,
    seed,
    notes,
    statistics: {
      noteCount: notes.length,
      noteTypes: {
        tap: notes.filter((note) => note.type === 'tap').length,
        hold: notes.filter((note) => note.type === 'hold').length,
        flick: notes.filter((note) => note.type === 'flick').length,
      },
      notesPerSecond: round(notes.length / options.analysis.duration, 2),
      tempoEstimateScore: options.tempo.confidence,
      phaseCoherence: options.tempo.phaseCoherence,
      onsetCandidates: options.analysis.peaks.length,
      gridCandidates: events.length,
      laneCounts: counts,
    },
  });
}
