import {
  createGridEvents, type AudioAnalysis, type TempoEstimate,
} from './audio-analysis.ts';
import {
  validateChart, type Chart, type ChartDifficulty, type ChartNote,
} from './schema.ts';

interface DifficultyConfig {
  readonly subdivision: number;
  readonly eventStep: number;
  readonly chords: boolean;
}

const DIFFICULTIES: Readonly<Record<ChartDifficulty, DifficultyConfig>> = {
  easy: { subdivision: 2, eventStep: 1, chords: false },
  normal: { subdivision: 4, eventStep: 1, chords: false },
  hard: { subdivision: 4, eventStep: 1, chords: true },
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
): number {
  const candidates = counts.map((count, lane) => ({
    lane,
    cost: count * 10 + (lane === previousLane ? 2 : 0) + nextRandom(),
  }));
  candidates.sort((left, right) => left.cost - right.cost);
  return candidates[0]!.lane;
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
  const notes: ChartNote[] = [];
  let previousLane = -1;

  for (const event of events) {
    const lane = chooseLane(counts, previousLane, nextRandom);
    counts[lane]! += 1;
    notes.push({ time: round(event.time), lane, type: 'tap' });
    previousLane = lane;

    const strongBeat = event.index % config.subdivision === 0;
    if (config.chords && strongBeat && event.strength >= 2.5) {
      const other = chooseLane(
        counts.map((count, candidate) => count + (candidate === lane ? 1000 : 0)),
        lane,
        nextRandom,
      );
      counts[other]! += 1;
      notes.push({ time: round(event.time), lane: other, type: 'tap' });
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
      notesPerSecond: round(notes.length / options.analysis.duration, 2),
      tempoEstimateScore: options.tempo.confidence,
      phaseCoherence: options.tempo.phaseCoherence,
      onsetCandidates: options.analysis.peaks.length,
      gridCandidates: events.length,
      laneCounts: counts,
    },
  });
}
