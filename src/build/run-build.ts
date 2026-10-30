import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { analyzeAudio } from '../chart/audio-analysis.ts';
import { generateChart } from '../chart/generate-chart.ts';
import { writeChartAtomic } from '../chart/schema.ts';
import { createBackground } from '../media/background.ts';
import { preflight } from '../media/probe.ts';
import { composeFinal } from '../video/compose-final.ts';
import { renderOverlay } from '../video/render-overlay.ts';
import { loadConfig } from './config.ts';
import { acquireBuildLock } from './build-lock.ts';
import { resolveInputs } from './inputs.ts';

interface BuildDependencies {
  readonly loadConfig: typeof loadConfig;
  readonly resolveInputs: typeof resolveInputs;
  readonly preflight: typeof preflight;
  readonly mkdir: typeof mkdir;
  readonly acquireBuildLock: typeof acquireBuildLock;
  readonly createBackground: typeof createBackground;
  readonly analyzeAudio: typeof analyzeAudio;
  readonly generateChart: typeof generateChart;
  readonly writeChartAtomic: typeof writeChartAtomic;
  readonly renderOverlay: typeof renderOverlay;
  readonly composeFinal: typeof composeFinal;
}

const DEFAULT_DEPENDENCIES: BuildDependencies = {
  loadConfig,
  resolveInputs,
  preflight,
  mkdir,
  acquireBuildLock,
  createBackground,
  analyzeAudio,
  generateChart,
  writeChartAtomic,
  renderOverlay,
  composeFinal,
};

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
  const config = await dependencies.loadConfig({ cwd, inputPath: options.inputPath });
  const inputs = await dependencies.resolveInputs({
    inputPath: options.inputPath,
    cover: config.cover,
  });
  await dependencies.preflight({
    mode: inputs.mode, ffmpeg: ffmpegPath, ffprobe: ffprobePath,
  });
  await dependencies.mkdir(config.outDir, { recursive: true });
  const buildLock = await dependencies.acquireBuildLock(config.outDir);

  try {
    const paths = {
      background: join(config.outDir, 'background.mp4'),
      chart: join(config.outDir, 'chart.json'),
      overlay: join(config.outDir, 'overlay.mov'),
      final: join(config.outDir, 'final.mp4'),
      log: join(config.outDir, 'build.log'),
    };
    const timings = { background: 0, chart: 0, overlay: 0, final: 0 };
    const timed = async <T>(name: keyof typeof timings, action: () => Promise<T>): Promise<T> => {
      const startedAt = now();
      const result = await action();
      timings[name] = now() - startedAt;
      log(`[完了] ${name}: ${formatElapsed(timings[name])}`);
      return result;
    };

    const background = await timed('background', () => dependencies.createBackground({
      inputs, outputPath: paths.background, logPath: paths.log,
      ffmpegPath, ffprobePath,
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
      await dependencies.writeChartAtomic(generated, paths.chart);
      return generated;
    });
    await timed('overlay', () => dependencies.renderOverlay({
      chart,
      backgroundMedia: background.media,
      layout: config.layout,
      outputPath: paths.overlay,
      logPath: paths.log,
      ffmpegPath,
      ffprobePath,
    }));
    await timed('final', () => dependencies.composeFinal({
      backgroundPath: paths.background,
      overlayPath: paths.overlay,
      backgroundMedia: background.media,
      outputPath: paths.final,
      logPath: paths.log,
      ffmpegPath,
      ffprobePath,
    }));

    const elapsedMs: BuildTimings = { ...timings, total: now() - totalStartedAt };
    log(`[完了] 合計: ${formatElapsed(elapsedMs.total)}`);
    log(`[出力] ${paths.final}`);
    return { finalPath: paths.final, elapsedMs };
  } finally {
    await buildLock.release();
  }
}
