import {
  createGameEngine,
  type GameEngine,
  type GameInput,
  type GameSnapshot,
  type JudgmentRecord,
} from './game-engine.ts';
import type { PlayableSong } from './song-source.ts';

export type GamePhase = 'setup' | 'ready' | 'playing' | 'paused' | 'result';
export type PauseReason = 'blur' | 'hidden' | 'media-paused';
export type ResultStage = 'rank' | 'full-combo';

export interface GameMedia {
  readonly currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

export interface ControllerSnapshot {
  readonly phase: GamePhase;
  readonly song: PlayableSong | null;
  readonly game: GameSnapshot | null;
  readonly pauseReason: PauseReason | null;
  readonly resultStage: ResultStage | null;
}

export interface GameController {
  readonly snapshot: ControllerSnapshot;
  load(song: PlayableSong): void;
  start(): Promise<void>;
  tick(): void;
  inputAt(input: Omit<GameInput, 'time'>, videoTime: number): JudgmentRecord | null;
  interrupt(reason: PauseReason): void;
  resume(): Promise<void>;
  finish(): void;
  revealFullCombo(): void;
  reset(): void;
}

export function createGameController(media: GameMedia): GameController {
  let phase: GamePhase = 'setup';
  let song: PlayableSong | null = null;
  let engine: GameEngine | null = null;
  let pauseReason: PauseReason | null = null;
  let resultStage: ResultStage | null = null;

  function load(nextSong: PlayableSong): void {
    song?.dispose();
    song = nextSong;
    engine = createGameEngine(nextSong.chart);
    phase = 'ready';
    pauseReason = null;
    resultStage = null;
  }

  async function start(): Promise<void> {
    if (phase !== 'ready' || !engine) throw new Error('A song must be ready before starting');
    await media.play();
    phase = 'playing';
    engine.advance(media.currentTime);
  }

  function tick(): void {
    if (phase === 'playing') engine?.advance(media.currentTime);
  }

  function inputAt(
    input: Omit<GameInput, 'time'>,
    videoTime: number,
  ): JudgmentRecord | null {
    if (phase !== 'playing' || !engine) return null;
    return engine.input({ ...input, time: videoTime });
  }

  function interrupt(reason: PauseReason): void {
    if (phase !== 'playing') return;
    engine?.advance(media.currentTime);
    phase = 'paused';
    pauseReason = reason;
    media.pause();
  }

  async function resume(): Promise<void> {
    if (phase !== 'paused' || !engine) throw new Error('Game is not paused');
    await media.play();
    engine.advance(media.currentTime);
    phase = 'playing';
    pauseReason = null;
  }

  function finish(): void {
    if (!engine || !song || (phase !== 'playing' && phase !== 'paused')) return;
    engine.advance(song.chart.duration + 0.221);
    phase = 'result';
    pauseReason = null;
    resultStage = 'rank';
  }

  function revealFullCombo(): void {
    if (phase === 'result' && engine?.snapshot.fullCombo) resultStage = 'full-combo';
  }

  function reset(): void {
    if (phase === 'playing') media.pause();
    song?.dispose();
    song = null;
    engine = null;
    phase = 'setup';
    pauseReason = null;
    resultStage = null;
  }

  return {
    load,
    start,
    tick,
    inputAt,
    interrupt,
    resume,
    finish,
    revealFullCombo,
    reset,
    get snapshot(): ControllerSnapshot {
      return {
        phase,
        song,
        game: engine?.snapshot ?? null,
        pauseReason,
        resultStage,
      };
    },
  };
}
