import { rename, rm } from 'node:fs/promises';

import { probeMedia, type ProbeMetadata } from '../media/probe.ts';
import { runProcess, type ProcessResult } from '../platform/process.ts';
import { writeStageErrorLog } from '../platform/stage-log.ts';
import { temporarySiblingPath } from '../platform/temporary-path.ts';

export interface FinalArgsOptions {
  readonly backgroundPath: string;
  readonly overlayPath: string;
  readonly outputPath: string;
  readonly durationSec: number;
}

export function buildFinalArgs(options: FinalArgsOptions): string[] {
  return [
    '-hide_banner', '-stats', '-loglevel', 'warning',
    '-i', options.backgroundPath, '-i', options.overlayPath,
    '-filter_complex', '[0:v:0][1:v:0]overlay=0:0:format=auto:shortest=1[v]',
    '-map', '[v]', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-fps_mode', 'cfr', '-r', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k',
    '-movflags', '+faststart', '-t', String(options.durationSec),
    '-y', options.outputPath,
  ];
}

type RunProcessFn = (
  command: string, args: readonly string[],
) => Promise<ProcessResult>;
type ProbeMediaFn = (
  path: string, options: { readonly ffprobe?: string },
) => Promise<ProbeMetadata>;

export interface ComposeFinalOptions {
  readonly backgroundPath: string;
  readonly overlayPath: string;
  readonly backgroundMedia: ProbeMetadata;
  readonly outputPath: string;
  readonly logPath: string;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly now?: () => number;
  readonly runProcessFn?: RunProcessFn;
  readonly probeMediaFn?: ProbeMediaFn;
}

export interface FinalResult {
  readonly path: string;
  readonly media: ProbeMetadata;
  readonly elapsedMs: number;
}

function validateFinal(media: ProbeMetadata, background: ProbeMetadata): void {
  const video = media.video;
  const audio = media.audio;
  const source = background.video;
  if (!video || !audio || !source) throw new Error('Final output must contain video and audio');
  if (video.codec !== 'h264' || audio.codec !== 'aac') {
    throw new Error('Final output must use H.264 video and AAC audio');
  }
  if (video.displayWidth !== source.displayWidth || video.displayHeight !== source.displayHeight) {
    throw new Error('Final output dimensions must match the background');
  }
  if (video.isVfr || Math.abs(video.avgFps - 30) > 1e-3) {
    throw new Error('Final output must be 30fps CFR');
  }
  if (Math.abs(media.durationSec - background.durationSec) > 1 / 30 + 0.001) {
    throw new Error('Final output duration must match the background');
  }
}

function diagnostics(error: unknown): { code: number | string | null; stderr: string } {
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return {
      code: typeof value.code === 'number' || typeof value.code === 'string' ? value.code : null,
      stderr: typeof value.stderr === 'string' ? value.stderr : '',
    };
  }
  return { code: null, stderr: '' };
}

export async function composeFinal(options: ComposeFinalOptions): Promise<FinalResult> {
  if (!options.backgroundMedia.video || !options.backgroundMedia.audio) {
    throw new Error('Background must contain video and audio');
  }
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const execute = options.runProcessFn ?? runProcess;
  const probe = options.probeMediaFn ?? probeMedia;
  const now = options.now ?? Date.now;
  const temporaryPath = temporarySiblingPath(options.outputPath);
  const args = buildFinalArgs({
    backgroundPath: options.backgroundPath,
    overlayPath: options.overlayPath,
    outputPath: temporaryPath,
    durationSec: options.backgroundMedia.durationSec,
  });
  const startedAt = now();

  try {
    await execute(ffmpegPath, args);
    const media = await probe(temporaryPath, { ffprobe: ffprobePath });
    validateFinal(media, options.backgroundMedia);
    await rename(temporaryPath, options.outputPath);
    return { path: options.outputPath, media, elapsedMs: now() - startedAt };
  } catch (error) {
    const detail = diagnostics(error);
    await writeStageErrorLog({
      logPath: options.logPath, stage: 'final', command: ffmpegPath,
      args, code: detail.code, stderr: detail.stderr,
    });
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
