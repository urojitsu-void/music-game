import { access } from 'node:fs/promises';

import {
  commandExists, runProcess, type ProcessResult,
} from '../platform/process.ts';

export interface VideoMetadata {
  readonly index: number;
  readonly codec: string;
  readonly encodedWidth: number;
  readonly encodedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly rotationDeg: number;
  readonly avgFps: number;
  readonly isVfr: boolean;
  readonly startSec: number;
  readonly durationSec: number;
}

export interface AudioMetadata {
  readonly index: number;
  readonly codec: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly startSec: number;
  readonly durationSec: number;
}

export interface ProbeMetadata {
  readonly durationSec: number;
  readonly video: VideoMetadata | null;
  readonly audio: AudioMetadata | null;
}

type UnknownRecord = Record<string, unknown>;
type RunProcessFn = (
  command: string, args: readonly string[],
) => Promise<ProcessResult>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function fraction(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function streamDuration(stream: UnknownRecord, formatDuration: number): number {
  return finiteNumber(stream.duration, formatDuration);
}

function rotation(stream: UnknownRecord): number {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  const rotationData = sideData
    .map(record)
    .find((item) => item !== null && Number.isFinite(Number(item.rotation)));
  const tags = record(stream.tags);
  const raw = rotationData?.rotation ?? tags?.rotate ?? 0;
  const degrees = finiteNumber(raw, 0);
  return ((Math.round(degrees) % 360) + 360) % 360;
}

function parseVideo(stream: UnknownRecord, formatDuration: number): VideoMetadata {
  const encodedWidth = integer(stream.width);
  const encodedHeight = integer(stream.height);
  const rotationDeg = rotation(stream);
  const swapsDimensions = rotationDeg === 90 || rotationDeg === 270;
  const avgFps = fraction(stream.avg_frame_rate);
  const realFps = fraction(stream.r_frame_rate);

  return Object.freeze({
    index: integer(stream.index),
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : 'unknown',
    encodedWidth,
    encodedHeight,
    displayWidth: swapsDimensions ? encodedHeight : encodedWidth,
    displayHeight: swapsDimensions ? encodedWidth : encodedHeight,
    rotationDeg,
    avgFps,
    isVfr: avgFps > 0 && realFps > 0 && Math.abs(avgFps - realFps) > 1e-6,
    startSec: finiteNumber(stream.start_time, 0),
    durationSec: streamDuration(stream, formatDuration),
  });
}

function parseAudio(stream: UnknownRecord, formatDuration: number): AudioMetadata {
  return Object.freeze({
    index: integer(stream.index),
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : 'unknown',
    sampleRate: integer(stream.sample_rate),
    channels: integer(stream.channels),
    startSec: finiteNumber(stream.start_time, 0),
    durationSec: streamDuration(stream, formatDuration),
  });
}

export function parseProbe(value: unknown): ProbeMetadata {
  const root = record(value);
  const format = record(root?.format);
  const durationSec = finiteNumber(format?.duration, Number.NaN);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('FFprobe output has no valid media duration');
  }

  const streams = (Array.isArray(root?.streams) ? root.streams : [])
    .map(record)
    .filter((stream): stream is UnknownRecord => stream !== null)
    .sort((left, right) => integer(left.index) - integer(right.index));
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');

  if (videoStream && !audioStream) {
    throw new Error('Video input must contain an audio stream');
  }
  if (!videoStream && !audioStream) {
    throw new Error('Media must contain an audio or video stream');
  }

  return Object.freeze({
    durationSec,
    video: videoStream ? parseVideo(videoStream, durationSec) : null,
    audio: audioStream ? parseAudio(audioStream, durationSec) : null,
  });
}

export async function probeMedia(
  path: string,
  options: { readonly ffprobe?: string; readonly runProcessFn?: RunProcessFn } = {},
): Promise<ProbeMetadata> {
  const ffprobe = options.ffprobe ?? 'ffprobe';
  const execute = options.runProcessFn ?? runProcess;
  const { stdout } = await execute(ffprobe, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`FFprobe returned invalid JSON for ${path}`, { cause: error });
  }
  return parseProbe(parsed);
}

type PreflightMode = 'mp3' | 'video';
type CommandExistsFn = (command: string) => Promise<boolean>;
type CheckChromiumFn = () => Promise<boolean>;

export interface PreflightOptions {
  readonly mode: PreflightMode;
  readonly ffmpeg?: string;
  readonly ffprobe?: string;
  readonly nodeVersion?: string;
  readonly commandExistsFn?: CommandExistsFn;
  readonly runProcessFn?: RunProcessFn;
  readonly checkChromium?: CheckChromiumFn;
}

async function chromiumIsInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    await access(chromium.executablePath());
    return true;
  } catch {
    return false;
  }
}

export async function preflight(options: PreflightOptions): Promise<void> {
  const {
    mode,
    ffmpeg = 'ffmpeg',
    ffprobe = 'ffprobe',
    nodeVersion = process.versions.node,
    commandExistsFn = commandExists,
    runProcessFn = runProcess,
    checkChromium = chromiumIsInstalled,
  } = options;

  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
    throw new Error(`Node.js 20 or newer is required (found ${nodeVersion})`);
  }

  if (!await commandExistsFn(ffmpeg)) {
    throw new Error(`FFmpeg executable not found: ${ffmpeg}`);
  }
  if (!await commandExistsFn(ffprobe)) {
    throw new Error(`FFprobe executable not found: ${ffprobe}`);
  }

  await runProcessFn(ffmpeg, ['-version']);
  await runProcessFn(ffprobe, ['-version']);

  if (mode === 'mp3') {
    const filters = await runProcessFn(ffmpeg, ['-filters']);
    if (!/\bsubtitles\b/.test(`${filters.stdout}\n${filters.stderr}`)) {
      throw new Error('FFmpeg subtitles filter is required; install an FFmpeg build with libass');
    }
  }

  if (!await checkChromium()) {
    throw new Error('Playwright Chromium is not installed. Run: npx playwright install chromium');
  }
}
