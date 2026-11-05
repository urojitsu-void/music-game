import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { analyzeAudio } from '../chart/audio-analysis.ts';
import { generateChart } from '../chart/generate-chart.ts';
import { writeChartAtomic } from '../chart/schema.ts';
import { createBackground } from '../media/background.ts';
import { preflight } from '../media/probe.ts';
import { acquireBuildLock } from './build-lock.ts';
import { loadConfig } from './config.ts';
import { resolveInputs } from './inputs.ts';

export interface PreparePlayableDependencies {
  readonly loadConfig: typeof loadConfig;
  readonly resolveInputs: typeof resolveInputs;
  readonly preflight: typeof preflight;
  readonly mkdir: typeof mkdir;
  readonly acquireBuildLock: typeof acquireBuildLock;
  readonly createBackground: typeof createBackground;
  readonly analyzeAudio: typeof analyzeAudio;
  readonly generateChart: typeof generateChart;
  readonly writeChartAtomic: typeof writeChartAtomic;
}

const DEFAULT_DEPENDENCIES: PreparePlayableDependencies = {
  loadConfig,
  resolveInputs,
  preflight,
  mkdir,
  acquireBuildLock,
  createBackground,
  analyzeAudio,
  generateChart,
  writeChartAtomic,
};

export interface PreparePlayableTimings {
  readonly background: number;
  readonly chart: number;
  readonly total: number;
}

export interface PreparedPlayable {
  readonly backgroundPath: string;
  readonly chartPath: string;
  readonly logPath: string;
  readonly background: Awaited<ReturnType<typeof createBackground>>;
  readonly chart: ReturnType<typeof generateChart>;
  readonly config: Awaited<ReturnType<typeof loadConfig>>;
  readonly elapsedMs: PreparePlayableTimings;
}

export interface PreparePlayableOptions {
  readonly cwd?: string;
  readonly inputPath: string;
  readonly subtitle?: string | null;
  readonly outDir?: string;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly dependencies?: Partial<PreparePlayableDependencies>;
}

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}秒`;
}

export async function withPreparedPlayable<T>(
  options: PreparePlayableOptions,
  usePrepared: (prepared: PreparedPlayable) => Promise<T>,
): Promise<T> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? Date.now;
  const log = options.log ?? console.log;
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH ?? 'ffprobe';
  const config = await dependencies.loadConfig({
    cwd,
    inputPath: options.inputPath,
    cli: options.outDir === undefined ? {} : { outDir: options.outDir },
  });
  const inputs = await dependencies.resolveInputs({
    inputPath: options.inputPath,
    cover: config.cover,
    subtitle: options.subtitle,
  });
  await dependencies.preflight({
    mode: inputs.mode,
    requiresSubtitles: inputs.subtitlePath !== null,
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
  });
  await dependencies.mkdir(config.outDir, { recursive: true });
  const buildLock = await dependencies.acquireBuildLock(config.outDir);

  try {
    const backgroundPath = join(config.outDir, 'background.mp4');
    const chartPath = join(config.outDir, 'chart.json');
    const logPath = join(config.outDir, 'build.log');
    const timings = { background: 0, chart: 0 };
    const timed = async <TResult>(
      name: keyof typeof timings,
      action: () => Promise<TResult>,
    ): Promise<TResult> => {
      const startedAt = now();
      const result = await action();
      timings[name] = now() - startedAt;
      log(`[完了] ${name}: ${formatElapsed(timings[name])}`);
      return result;
    };

    const background = await timed('background', () => dependencies.createBackground({
      inputs, outputPath: backgroundPath, logPath, ffmpegPath, ffprobePath,
    }));
    const audioPath = inputs.mode === 'mp3' ? inputs.audioPath : inputs.videoPath;
    const chart = await timed('chart', async () => {
      const analyzed = await dependencies.analyzeAudio(audioPath, { ffmpegPath });
      const generated = dependencies.generateChart({
        analysis: analyzed.analysis,
        tempo: analyzed.tempo,
        audioName: basename(audioPath),
        difficulty: config.difficulty,
        seed: config.seed,
      });
      await dependencies.writeChartAtomic(generated, chartPath);
      return generated;
    });
    return await usePrepared({
      backgroundPath,
      chartPath,
      logPath,
      background,
      chart,
      config,
      elapsedMs: { ...timings, total: timings.background + timings.chart },
    });
  } finally {
    await buildLock.release();
  }
}

export function preparePlayable(options: PreparePlayableOptions): Promise<PreparedPlayable> {
  return withPreparedPlayable(options, async (prepared) => prepared);
}
