import {
  rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import type { ResolvedInputs } from '../build/inputs.ts';
import {
  runProcess, type ProcessResult,
} from '../platform/process.ts';
import {
  probeMedia, type ProbeMetadata,
} from './probe.ts';

const SPECTRUM_GRAPH = [
  '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,format=yuv420p[background]',
  '[1:a]showfreqs=s=1280x200:mode=bar:ascale=sqrt:fscale=log:colors=white:rate=30,format=rgba,colorkey=0x000000:0.08:0.0,split=7[w0][w1][w2][w3][w4][w5][w6]',
  '[w0]crop=183:200:0:0,colorchannelmixer=rr=1:gg=0:bb=0:aa=0.45[c0]',
  '[w1]crop=183:200:183:0,colorchannelmixer=rr=1:gg=0.45:bb=0:aa=0.45[c1]',
  '[w2]crop=183:200:366:0,colorchannelmixer=rr=1:gg=0.95:bb=0:aa=0.45[c2]',
  '[w3]crop=183:200:549:0,colorchannelmixer=rr=0:gg=1:bb=0.25:aa=0.45[c3]',
  '[w4]crop=183:200:732:0,colorchannelmixer=rr=0:gg=0.95:bb=1:aa=0.45[c4]',
  '[w5]crop=183:200:915:0,colorchannelmixer=rr=0.2:gg=0.35:bb=1:aa=0.45[c5]',
  '[w6]crop=182:200:1098:0,colorchannelmixer=rr=1:gg=0.1:bb=0.85:aa=0.45[c6]',
  '[background][c0]overlay=0:H-h[o0]',
  '[o0][c1]overlay=183:H-h[o1]',
  '[o1][c2]overlay=366:H-h[o2]',
  '[o2][c3]overlay=549:H-h[o3]',
  '[o3][c4]overlay=732:H-h[o4]',
  '[o4][c5]overlay=915:H-h[o5]',
  '[o5][c6]overlay=1098:H-h,format=yuv420p[spectrum]',
].join(';');

export interface Mp3BackgroundArgsOptions {
  readonly coverPath: string;
  readonly audioPath: string;
  readonly subtitlePath: string;
  readonly outputPath: string;
}

export function buildMp3BackgroundArgs(options: Mp3BackgroundArgsOptions): string[] {
  const subtitlePath = options.subtitlePath
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
  const subtitles = `subtitles=filename='${subtitlePath}':force_style='FontSize=22,Outline=2,Shadow=1,MarginV=45'`;
  const graph = `${SPECTRUM_GRAPH};[spectrum]${subtitles}[v]`;
  return [
    '-hide_banner', '-stats', '-loglevel', 'warning',
    '-loop', '1', '-framerate', '30', '-i', options.coverPath,
    '-i', options.audioPath,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30',
    '-c:a', 'aac', '-b:a', '256k', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-shortest', '-y', options.outputPath,
  ];
}

export interface VideoBackgroundArgsOptions {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly media: ProbeMetadata;
}

function seconds(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function buildVideoBackgroundArgs(options: VideoBackgroundArgsOptions): string[] {
  const { video, audio } = options.media;
  if (!video || !audio) throw new Error('Video input must contain video and audio streams');
  const duration = seconds(video.durationSec);
  const graph = [
    `[0:${video.index}]setpts=PTS-STARTPTS,fps=30,scale=${video.displayWidth}:${video.displayHeight}:flags=lanczos,setsar=1,format=yuv420p[v]`,
    `[0:${audio.index}]asetpts=PTS-STARTPTS,apad,atrim=duration=${duration}[a]`,
  ].join(';');
  return [
    '-hide_banner', '-stats', '-loglevel', 'warning', '-i', options.inputPath,
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-fps_mode', 'cfr', '-r', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-metadata:s:v:0', 'rotate=0',
    '-movflags', '+faststart', '-t', duration, '-y', options.outputPath,
  ];
}

type RunProcessFn = (
  command: string, args: readonly string[],
) => Promise<ProcessResult>;
type ProbeMediaFn = (
  path: string, options: { readonly ffprobe?: string },
) => Promise<ProbeMetadata>;

export interface CreateBackgroundOptions {
  readonly inputs: ResolvedInputs;
  readonly outputPath: string;
  readonly logPath: string;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly runProcessFn?: RunProcessFn;
  readonly probeMediaFn?: ProbeMediaFn;
}

export interface BackgroundResult {
  readonly path: string;
  readonly media: ProbeMetadata;
}

function temporaryOutputPath(outputPath: string): string {
  const extension = extname(outputPath);
  const stem = basename(outputPath, extension);
  return join(dirname(outputPath), `${stem}.tmp${extension}`);
}

function errorDetails(error: unknown): { exitCode: unknown; stderr: string } {
  if (error !== null && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return {
      exitCode: value.code ?? null,
      stderr: typeof value.stderr === 'string' ? value.stderr : '',
    };
  }
  return { exitCode: null, stderr: '' };
}

async function writeStageErrorLog(
  logPath: string, executable: string, args: readonly string[], error: unknown,
): Promise<void> {
  const { exitCode, stderr } = errorDetails(error);
  const content = `${JSON.stringify({
    stage: 'background', executable, arguments: args, exitCode, stderr,
  }, null, 2)}\n`;
  const temporaryPath = `${logPath}.tmp`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, logPath);
}

function validateBackground(
  media: ProbeMetadata, expected: ProbeMetadata,
): void {
  if (!media.video || !media.audio) throw new Error('Background output must contain video and audio');
  if (media.video.codec !== 'h264' || media.audio.codec !== 'aac') {
    throw new Error('Background output must use H.264 video and AAC audio');
  }
  if (media.video.isVfr || Math.abs(media.video.avgFps - 30) > 1e-3) {
    throw new Error('Background output must be 30fps CFR');
  }
  const frame = 1 / 30;
  if (Math.abs(media.video.startSec) > frame + 0.001
    || Math.abs(media.audio.startSec) > frame + 0.001) {
    throw new Error('Background output must start at zero');
  }
  const expectedDuration = expected.video?.durationSec ?? expected.audio?.durationSec ?? expected.durationSec;
  if (Math.abs(media.durationSec - expectedDuration) > frame + 0.001) {
    throw new Error('Background output duration does not match the source');
  }
  if (expected.video
    && (media.video.displayWidth !== expected.video.displayWidth
      || media.video.displayHeight !== expected.video.displayHeight)) {
    throw new Error('Background output dimensions do not match the source display');
  }
}

export async function createBackground(options: CreateBackgroundOptions): Promise<BackgroundResult> {
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const execute = options.runProcessFn ?? runProcess;
  const probe = options.probeMediaFn ?? probeMedia;
  const temporaryOutput = temporaryOutputPath(options.outputPath);

  const sourcePath = options.inputs.mode === 'mp3'
    ? options.inputs.audioPath : options.inputs.videoPath;
  const sourceMedia = await probe(sourcePath, { ffprobe: ffprobePath });
  let args: string[];

  if (options.inputs.mode === 'mp3') {
    args = buildMp3BackgroundArgs({
      coverPath: options.inputs.coverPath,
      audioPath: options.inputs.audioPath,
      subtitlePath: options.inputs.lrcPath,
      outputPath: temporaryOutput,
    });
  } else {
    args = buildVideoBackgroundArgs({
      inputPath: options.inputs.videoPath,
      outputPath: temporaryOutput,
      media: sourceMedia,
    });
  }

  try {
    await execute(ffmpegPath, args);
  } catch (error) {
    await writeStageErrorLog(options.logPath, ffmpegPath, args, error);
    await rm(temporaryOutput, { force: true });
    throw error;
  }

  const outputMedia = await probe(temporaryOutput, { ffprobe: ffprobePath });
  try {
    validateBackground(outputMedia, sourceMedia);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }
  await rename(temporaryOutput, options.outputPath);
  return { path: options.outputPath, media: outputMedia };
}
