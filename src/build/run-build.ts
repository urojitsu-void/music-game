import { join } from 'node:path';

import { composeFinal } from '../video/compose-final.ts';
import { renderOverlay } from '../video/render-overlay.ts';
import {
  withPreparedPlayable,
  type PreparePlayableDependencies,
} from './prepare-playable.ts';

interface BuildDependencies extends PreparePlayableDependencies {
  readonly renderOverlay: typeof renderOverlay;
  readonly composeFinal: typeof composeFinal;
}

const DEFAULT_DEPENDENCIES: BuildDependencies = {
  renderOverlay,
  composeFinal,
} as BuildDependencies;

export interface BuildTimings {
  readonly background: number;
  readonly chart: number;
  readonly overlay: number;
  readonly final: number;
  readonly total: number;
}

export interface BuildResult {
  readonly finalPath: string;
  readonly elapsedMs: BuildTimings;
}

export interface RunBuildOptions {
  readonly cwd?: string;
  readonly inputPath: string;
  readonly subtitle?: string | null;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly dependencies?: Partial<BuildDependencies>;
}

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}秒`;
}

export async function runBuild(options: RunBuildOptions): Promise<BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? Date.now;
  const log = options.log ?? console.log;
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH ?? 'ffprobe';
  const totalStartedAt = now();
  return withPreparedPlayable({
    cwd,
    inputPath: options.inputPath,
    subtitle: options.subtitle,
    now,
    log,
    dependencies,
  }, async (prepared) => {
    const paths = {
      overlay: join(prepared.config.outDir, 'overlay.mov'),
      final: join(prepared.config.outDir, 'final.mp4'),
    };
    const timings = {
      background: prepared.elapsedMs.background,
      chart: prepared.elapsedMs.chart,
      overlay: 0,
      final: 0,
    };
    const timed = async <T>(name: keyof typeof timings, action: () => Promise<T>): Promise<T> => {
      const startedAt = now();
      const result = await action();
      timings[name] = now() - startedAt;
      log(`[完了] ${name}: ${formatElapsed(timings[name])}`);
      return result;
    };

    await timed('overlay', () => dependencies.renderOverlay({
      chart: prepared.chart,
      backgroundMedia: prepared.background.media,
      layout: prepared.config.layout,
      outputPath: paths.overlay,
      logPath: prepared.logPath,
      ffmpegPath,
      ffprobePath,
    }));
    await timed('final', () => dependencies.composeFinal({
      backgroundPath: prepared.backgroundPath,
      overlayPath: paths.overlay,
      backgroundMedia: prepared.background.media,
      outputPath: paths.final,
      logPath: prepared.logPath,
      ffmpegPath,
      ffprobePath,
    }));

    const elapsedMs: BuildTimings = { ...timings, total: now() - totalStartedAt };
    log(`[完了] 合計: ${formatElapsed(elapsedMs.total)}`);
    log(`[出力] ${paths.final}`);
    return { finalPath: paths.final, elapsedMs };
  });
}
