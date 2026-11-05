import {
  useEffect, useRef, useState, type PointerEvent as ReactPointerEvent,
} from 'react';

import { validateChart } from '../chart/validation.ts';
import { loadBrowserRenderAssets } from '../render/browser-render-assets.ts';
import {
  renderFrame, type CanvasLike, type RenderAssets,
} from '../render/canvas-renderer.ts';
import { DEFAULT_PLAYLIST_URL } from './data-config.ts';
import {
  createGameController, type ControllerSnapshot, type GameController,
} from './game-controller.ts';
import {
  createKeyboardInputTranslator, shouldPreventGameKeyDefault,
  type KeyboardGameAction,
} from './keyboard-input.ts';
import { createPointerInputTranslator, type PointerGameAction } from './pointer-input.ts';
import {
  loadReleaseCatalog, loadReleaseSong,
  type ReleaseCatalog, type ReleaseCatalogSong,
} from './release-catalog.ts';
import { derivePlayFrameState } from './render-state.ts';
import type { PlayableSong } from './song-source.ts';

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const LAYOUT = { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 } as const;

function inputVideoTime(video: HTMLVideoElement, eventTimeMs: number): number {
  const delaySeconds = Math.max(0, performance.now() - eventTimeMs) / 1_000;
  return Math.max(0, video.currentTime - delaySeconds);
}

function SetupScreen({ onSong }: { readonly onSong: (song: PlayableSong) => void }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ReleaseCatalog | null>(null);
  const [debug, setDebug] = useState(false);
  const [debugStatus, setDebugStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let playlistUrl = DEFAULT_PLAYLIST_URL;
      try {
        const response = await fetch('/api/runtime', { cache: 'no-store' });
        if (response.ok) {
          const runtime = await response.json() as { debug?: unknown; playlistUrl?: unknown };
          if (!cancelled) setDebug(runtime.debug === true);
          if (typeof runtime.playlistUrl === 'string') playlistUrl = runtime.playlistUrl;
        }
      } catch {
        if (!cancelled) setDebug(false);
      }
      try {
        const loaded = await loadReleaseCatalog(playlistUrl);
        if (!cancelled) setCatalog(loaded);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectReleaseSong = async (entry: ReleaseCatalogSong): Promise<void> => {
    if (!catalog) return;
    setLoadingSongId(entry.id);
    setError(null);
    try {
      onSong(await loadReleaseSong(catalog, entry));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingSongId(null);
    }
  };

  const loadDebugOutput = async (): Promise<void> => {
    setLoadingSongId('debug-output');
    setError(null);
    try {
      const response = await fetch('/api/debug/output', { cache: 'no-store' });
      const value = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'outputを読み込めません');
      const chart = validateChart(value.chart);
      if (typeof value.backgroundVideoUrl !== 'string' || typeof value.title !== 'string') {
        throw new TypeError('debug output response is invalid');
      }
      const statusResponse = await fetch('/api/debug/status', { cache: 'no-store' });
      if (statusResponse.ok) setDebugStatus(JSON.stringify(await statusResponse.json(), null, 2));
      onSong({
        id: typeof value.id === 'string' ? value.id : 'debug-output',
        title: value.title,
        artist: null,
        thumbnailUrl: null,
        backgroundVideoUrl: `${value.backgroundVideoUrl}?reload=${Date.now()}`,
        chart,
        dispose: () => undefined,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingSongId(null);
    }
  };

  return <main className="setup-screen">
    <h1>MUSIC GAME</h1>
    <p>GitHub Releasesから曲を選んでプレイします。</p>
    <section className="setup-card">
      <h2>PLAYLIST</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {!catalog && !error && <p>読み込み中…</p>}
      {catalog && catalog.songs.length === 0 && <p>公開されている曲はありません。</p>}
      <div className="song-grid">
        {catalog?.songs.map((entry) => <button className="song-card" type="button"
          key={entry.id} disabled={loadingSongId !== null}
          onClick={() => { void selectReleaseSong(entry); }}>
          {entry.thumbnailUrl && <img src={entry.thumbnailUrl} alt="" />}
          <span><b>{entry.title}</b>{entry.artist && <small>{entry.artist}</small>}</span>
          {loadingSongId === entry.id && <em>読み込み中…</em>}
        </button>)}
      </div>
    </section>
    {debug && <section className="setup-card">
      <h2>DEBUG</h2>
      <p>既定のoutput/background.mp4とoutput/chart.jsonを再読込します。</p>
      <button type="button" disabled={loadingSongId !== null} onClick={() => { void loadDebugOutput(); }}>
        output/を読み込む
      </button>
      {debugStatus && <pre>{debugStatus}</pre>}
    </section>}
  </main>;
}

export function GameApp(): React.JSX.Element {
  const [song, setSong] = useState<PlayableSong | null>(null);
  const [view, setView] = useState<ControllerSnapshot | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GameController | null>(null);
  const assetsRef = useRef<RenderAssets | undefined>(undefined);
  const pointerRef = useRef(createPointerInputTranslator());

  const syncView = (): void => {
    const controller = controllerRef.current;
    if (controller) setView(controller.snapshot);
  };

  useEffect(() => {
    void loadBrowserRenderAssets().then((assets) => { assetsRef.current = assets; });
  }, []);

  useEffect(() => {
    if (!song) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    const controller = createGameController({
      get currentTime() { return video.currentTime; },
      play: () => video.play(),
      pause: () => video.pause(),
    });
    controller.load(song);
    controllerRef.current = controller;
    setView(controller.snapshot);
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.reset();
    };
  }, [song]);

  useEffect(() => {
    if (view?.phase !== 'playing' || !song) return undefined;
    let frame = 0;
    const draw = (): void => {
      const controller = controllerRef.current;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!controller || !canvas || !video || controller.snapshot.phase !== 'playing') return;
      controller.tick();
      const game = controller.snapshot.game;
      if (game) {
        const state = derivePlayFrameState(song.chart, game, video.currentTime);
        renderFrame(canvas as unknown as CanvasLike, song.chart, video.currentTime,
          LAYOUT, null, { mode: 'manual', state }, assetsRef.current);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [song, view?.phase]);

  useEffect(() => {
    if (view?.phase !== 'playing') return undefined;
    const translator = createKeyboardInputTranslator();
    const timers = new Set<number>();
    const dispatch = (actions: readonly KeyboardGameAction[]): void => {
      const controller = controllerRef.current;
      const video = videoRef.current;
      if (!controller || !video) return;
      for (const { timeMs, ...input } of actions) {
        controller.inputAt(input, inputVideoTime(video, timeMs));
      }
    };
    const flushLater = (): void => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        dispatch(translator.flush(performance.now()));
      }, 101);
      timers.add(timer);
    };
    const keydown = (event: KeyboardEvent): void => {
      if (shouldPreventGameKeyDefault(event.key, true)) event.preventDefault();
      dispatch(translator.handle({
        type: 'keydown', key: event.key, repeat: event.repeat, timeMs: event.timeStamp,
      }));
      flushLater();
    };
    const keyup = (event: KeyboardEvent): void => {
      if (shouldPreventGameKeyDefault(event.key, true)) event.preventDefault();
      dispatch(translator.handle({
        type: 'keyup', key: event.key, repeat: event.repeat, timeMs: event.timeStamp,
      }));
    };
    window.addEventListener('keydown', keydown, { passive: false });
    window.addEventListener('keyup', keyup, { passive: false });
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [view?.phase]);

  useEffect(() => {
    const interrupt = (reason: 'blur' | 'hidden'): void => {
      controllerRef.current?.interrupt(reason);
      syncView();
    };
    const blur = (): void => interrupt('blur');
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') interrupt('hidden');
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const dispatchPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  ): void => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const laneRect = {
      left: bounds.left + bounds.width * (LAYOUT.gameX - LAYOUT.gameWidth / 2),
      width: bounds.width * LAYOUT.gameWidth,
    };
    const actions: readonly PointerGameAction[] = pointerRef.current.handle({
      type,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timeMs: event.timeStamp,
      rect: laneRect,
    });
    const controller = controllerRef.current;
    const video = videoRef.current;
    if (controller && video) {
      for (const { timeMs, pointerId: _pointerId, ...input } of actions) {
        controller.inputAt(input, inputVideoTime(video, timeMs));
      }
    }
  };

  if (!song) {
    return <div className="app-shell">
      <SetupScreen onSong={(nextSong) => setSong(nextSong)} />
      <div className="orientation-warning">端末を横向きにしてください</div>
    </div>;
  }

  const start = async (): Promise<void> => {
    const video = videoRef.current;
    const controller = controllerRef.current;
    if (!video || !controller) return;
    video.currentTime = 0;
    await controller.start();
    syncView();
  };
  const resume = async (): Promise<void> => {
    await controllerRef.current?.resume();
    syncView();
  };
  const finish = (): void => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.finish();
    syncView();
    window.setTimeout(() => {
      controller.revealFullCombo();
      syncView();
    }, 900);
  };
  const changeSong = (): void => {
    controllerRef.current?.reset();
    controllerRef.current = null;
    setView(null);
    setSong(null);
  };
  const game = view?.game;

  return <div className="game-screen">
    <video ref={videoRef} src={song.backgroundVideoUrl} playsInline preload="auto"
      onEnded={finish}
      onPause={() => {
        if (controllerRef.current?.snapshot.phase === 'playing') {
          controllerRef.current.interrupt('media-paused');
          syncView();
        }
      }} />
    <canvas ref={canvasRef} width={GAME_WIDTH} height={GAME_HEIGHT}
      aria-label="音楽ゲームのプレイ領域"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatchPointer(event, 'pointerdown');
      }}
      onPointerMove={(event) => dispatchPointer(event, 'pointermove')}
      onPointerUp={(event) => dispatchPointer(event, 'pointerup')}
      onPointerCancel={(event) => dispatchPointer(event, 'pointercancel')} />
    {view?.phase === 'ready' && <div className="overlay-panel">
      <div className="overlay-card">
        <h1>{song.title}</h1>
        <p className="key-guide">PC: A S D F ／ フリック: レーンキー＋方向キー</p>
        <div className="controls">
          <button type="button" onClick={() => { void start(); }}>START</button>
          <button type="button" onClick={changeSong}>曲を変更</button>
        </div>
      </div>
    </div>}
    {view?.phase === 'paused' && <div className="overlay-panel">
      <div className="overlay-card">
        <h2>PAUSED</h2>
        <div className="controls">
          <button type="button" onClick={() => { void resume(); }}>再開</button>
          <button type="button" onClick={changeSong}>曲を変更</button>
        </div>
      </div>
    </div>}
    {view?.phase === 'result' && game && <div className="overlay-panel">
      <div className="overlay-card">
        <p>RANK</p>
        <div className="rank">{game.rank}</div>
        {view.resultStage === 'full-combo' && <div className="full-combo">FULL COMBO</div>}
        <h2>SCORE {game.score.toLocaleString('en-US')}</h2>
        <p>MAX COMBO {game.maxCombo}</p>
        <div className="result-grid">
          {(['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'] as const).map((name) =>
            <span key={name}>{name}<b>{game.counts[name]}</b></span>)}
        </div>
        <button type="button" onClick={changeSong}>曲を変更</button>
      </div>
    </div>}
    <div className="orientation-warning">端末を横向きにしてください</div>
  </div>;
}
