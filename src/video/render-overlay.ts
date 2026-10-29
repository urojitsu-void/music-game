import { once } from 'node:events';
import { rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Writable } from 'node:stream';

import { createCanvas } from '@napi-rs/canvas';

import type { Layout } from '../build/config.ts';
import type { Chart } from '../chart/schema.ts';
import { probeMedia, type ProbeMetadata } from '../media/probe.ts';
import { spawnProcess } from '../platform/process.ts';
import { writeStageErrorLog } from '../platform/stage-log.ts';
import { renderFrame, type CanvasLike } from '../render/canvas-renderer.ts';

const FPS = 30;

export function frameCountForDuration(durationSec: number): number {
  return Math.ceil(durationSec * FPS);
}

export function frameTime(frameIndex: number): number {
  return frameIndex / FPS;
}

export function buildOverlayArgs(options: {
  readonly width: number;
  readonly height: number;
  readonly durationSec: number;
  readonly outputPath: string;
}): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', 'pipe:0',
    '-an', '-c:v', 'prores_ks', '-profile:v', '4444',
    '-pix_fmt', 'yuva444p10le', '-r', String(FPS),
    '-t', String(options.durationSec), '-s', `${options.width}x${options.height}`,
    '-y', options.outputPath,
  ];
}

export interface FrameRenderer {
  render(timeSeconds: number): Buffer | Promise<Buffer>;
}

export interface FrameRendererOptions {
  readonly width: number;
  readonly height: number;
  readonly chart: Chart;
  readonly layout: Layout;
}

export function createNodeFrameRenderer(options: FrameRendererOptions): FrameRenderer {
  const canvas = createCanvas(options.width, options.height);
  return {
    render(timeSeconds) {
      renderFrame(
        canvas as unknown as CanvasLike,
        options.chart,
        timeSeconds,
        options.layout,
        null,
        { mode: 'autoplay' },
      );
      return canvas.toBuffer('image/png');
    },
  };
}

interface SpawnLikeResult {
  readonly child: { readonly stdin: Writable; kill?(): boolean };
  readonly completed: Promise<void>;
}

type SpawnProcessFn = (
  command: string, args: readonly string[], options: { readonly stdin: 'pipe' },
) => SpawnLikeResult;
type ProbeMediaFn = (
  path: string, options: { readonly ffprobe?: string; readonly requireAudio?: boolean },
) => Promise<ProbeMetadata>;
type CreateFrameRendererFn = (options: FrameRendererOptions) => FrameRenderer;

export interface RenderOverlayOptions {
  readonly chart: Chart;
  readonly backgroundMedia: ProbeMetadata;
  readonly layout: Layout;
  readonly outputPath: string;
  readonly logPath: string;
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly createFrameRendererFn?: CreateFrameRendererFn;
  readonly spawnProcessFn?: SpawnProcessFn;
  readonly probeMediaFn?: ProbeMediaFn;
}

function temporaryOutputPath(outputPath: string): string {
  const extension = extname(outputPath);
  return join(dirname(outputPath), `${basename(outputPath, extension)}.tmp${extension}`);
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

function validateOverlay(media: ProbeMetadata, background: ProbeMetadata): void {
  const video = media.video;
  const source = background.video;
  if (!video || !source) throw new Error('Overlay and background must contain video');
  if (video.codec !== 'prores'
    || (video.pixelFormat !== 'yuva444p10le' && video.pixelFormat !== 'yuva444p12le')) {
    throw new Error('Overlay must be ProRes 4444 with an alpha pixel format');
  }
  if (video.displayWidth !== source.displayWidth || video.displayHeight !== source.displayHeight) {
    throw new Error('Overlay dimensions must match the background');
  }
  if (video.isVfr || Math.abs(video.avgFps - FPS) > 1e-3) throw new Error('Overlay must be 30fps CFR');
  if (Math.abs(media.durationSec - background.durationSec) > 1 / FPS + 0.001) {
    throw new Error('Overlay duration must match the background');
  }
}

export async function renderOverlay(options: RenderOverlayOptions): Promise<{
  readonly path: string;
  readonly media: ProbeMetadata;
  readonly frameCount: number;
}> {
  const source = options.backgroundMedia.video;
  if (!source) throw new Error('Background media must contain video');
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const ffprobePath = options.ffprobePath ?? 'ffprobe';
  const spawn = options.spawnProcessFn ?? spawnProcess as SpawnProcessFn;
  const probe = options.probeMediaFn ?? probeMedia;
  const frameRenderer = (options.createFrameRendererFn ?? createNodeFrameRenderer)({
    width: source.displayWidth,
    height: source.displayHeight,
    chart: options.chart,
    layout: options.layout,
  });
  const temporaryOutput = temporaryOutputPath(options.outputPath);
  const args = buildOverlayArgs({
    width: source.displayWidth, height: source.displayHeight,
    durationSec: options.backgroundMedia.durationSec, outputPath: temporaryOutput,
  });
  const process = spawn(ffmpegPath, args, { stdin: 'pipe' });
  const frameCount = frameCountForDuration(options.backgroundMedia.durationSec);

  try {
    for (let index = 0; index < frameCount; index += 1) {
      const png = await frameRenderer.render(frameTime(index));
      if (!process.child.stdin.write(png)) await once(process.child.stdin, 'drain');
    }
    process.child.stdin.end();
    await process.completed;
    const media = await probe(temporaryOutput, { ffprobe: ffprobePath, requireAudio: false });
    validateOverlay(media, options.backgroundMedia);
    await rename(temporaryOutput, options.outputPath);
    return { path: options.outputPath, media, frameCount };
  } catch (error) {
    process.child.stdin.destroy();
    process.child.kill?.();
    await process.completed.catch(() => undefined);
    const detail = diagnostics(error);
    await writeStageErrorLog({
      logPath: options.logPath, stage: 'overlay', command: ffmpegPath,
      args, code: detail.code, stderr: detail.stderr,
    });
    await rm(temporaryOutput, { force: true });
    throw error;
  }
}
