import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export const ANALYSIS_SAMPLE_RATE = 11025;
const FFT_SIZE = 1024;
const HOP = 128;
const TWO_PI = Math.PI * 2;

export interface AnalysisPeak {
  readonly time: number;
  readonly strength: number;
  readonly band: number;
  readonly bands: readonly number[];
  readonly rms: number;
}

export interface AudioAnalysis {
  readonly onset: Float64Array;
  readonly peaks: readonly AnalysisPeak[];
  readonly rms: Float64Array;
  readonly duration: number;
  readonly sampleRate: number;
  readonly hopSize: number;
}

export interface TempoEstimate {
  readonly bpm: number;
  readonly offset: number;
  readonly confidence: number | null;
  readonly phaseCoherence: number;
}

export interface TempoOptions {
  readonly bpm?: number;
  readonly offset?: number;
  readonly minBpm?: number;
  readonly maxBpm?: number;
}

export interface GridEvent extends AnalysisPeak {
  readonly index: number;
  readonly sourceTime: number;
}

export async function decodeAudioToMono(
  path: string, options: { readonly ffmpegPath?: string } = {},
): Promise<Float32Array> {
  await access(path);
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(ANALYSIS_SAMPLE_RATE),
    '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1',
  ];
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr.trim()}`);

  const buffer = Buffer.concat(chunks);
  const sampleCount = Math.floor(buffer.length / 4);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }
  if (samples.length < ANALYSIS_SAMPLE_RATE * 2) {
    throw new Error('Audio must be at least 2 seconds.');
  }
  return samples;
}

function fftInPlace(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >>> 1;
    for (; reversed & bit; bit >>>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed]!, real[index]!];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed]!, imaginary[index]!];
    }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = -TWO_PI / length;
    const baseReal = Math.cos(angle);
    const baseImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let unitReal = 1;
      let unitImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const left = offset + index;
        const right = left + length / 2;
        const transformedReal = unitReal * real[right]! - unitImaginary * imaginary[right]!;
        const transformedImaginary = unitReal * imaginary[right]! + unitImaginary * real[right]!;
        real[right] = real[left]! - transformedReal;
        imaginary[right] = imaginary[left]! - transformedImaginary;
        real[left] = real[left]! + transformedReal;
        imaginary[left] = imaginary[left]! + transformedImaginary;
        const nextReal = unitReal * baseReal - unitImaginary * baseImaginary;
        unitImaginary = unitReal * baseImaginary + unitImaginary * baseReal;
        unitReal = nextReal;
      }
    }
  }
}

function movingMean(values: ArrayLike<number>, radius: number): Float64Array {
  const prefix = new Float64Array(values.length + 1);
  const result = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    prefix[index + 1] = prefix[index]! + values[index]!;
  }
  for (let index = 0; index < values.length; index += 1) {
    const left = Math.max(0, index - radius);
    const right = Math.min(values.length, index + radius + 1);
    result[index] = (prefix[right]! - prefix[left]!) / (right - left);
  }
  return result;
}

function percentile(values: ArrayLike<number>, quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const index = Math.floor(position);
  const fraction = position - index;
  return sorted[index]! * (1 - fraction)
    + sorted[Math.min(index + 1, sorted.length - 1)]! * fraction;
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

export function analyzeSamples(
  samples: Float32Array,
  options: { readonly sampleRate?: number } = {},
): AudioAnalysis {
  const sampleRate = options.sampleRate ?? ANALYSIS_SAMPLE_RATE;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive');
  if (samples.length < FFT_SIZE) throw new Error('Audio is too short to analyze');
  const frameSeconds = HOP / sampleRate;
  const frameCount = Math.floor((samples.length - FFT_SIZE) / HOP) + 1;
  const bandFlux = Array.from({ length: 3 }, () => new Float64Array(frameCount));
  const rms = new Float64Array(frameCount);
  const window = Float64Array.from(
    { length: FFT_SIZE },
    (_, index) => 0.5 * (1 - Math.cos(TWO_PI * index / (FFT_SIZE - 1))),
  );
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  const previous = new Float64Array(FFT_SIZE / 2 + 1);
  const binHz = sampleRate / FFT_SIZE;
  const bands = [[35, 190], [190, 1300], [1300, 5200]] as const;
  const binBands = new Int8Array(previous.length).fill(-1);
  const bandBinCounts = [0, 0, 0];
  for (let bin = 1; bin < binBands.length; bin += 1) {
    const hz = bin * binHz;
    for (let band = 0; band < bands.length; band += 1) {
      if (hz >= bands[band]![0] && hz < bands[band]![1]) {
        binBands[bin] = band;
        bandBinCounts[band]! += 1;
        break;
      }
    }
  }

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sumSquares = 0;
    const start = frame * HOP;
    for (let index = 0; index < FFT_SIZE; index += 1) {
      const value = samples[start + index]!;
      real[index] = value * window[index]!;
      imaginary[index] = 0;
      sumSquares += value * value;
    }
    rms[frame] = Math.sqrt(sumSquares / FFT_SIZE);
    fftInPlace(real, imaginary);
    for (let bin = 1; bin < previous.length; bin += 1) {
      const band = binBands[bin]!;
      if (band < 0) continue;
      const magnitude = Math.hypot(real[bin]!, imaginary[bin]!) / FFT_SIZE;
      const compressed = Math.log1p(magnitude * 200);
      bandFlux[band]![frame] += Math.max(0, compressed - previous[bin]!);
      previous[bin] = compressed;
    }
    for (let band = 0; band < 3; band += 1) {
      bandFlux[band]![frame] /= Math.sqrt(bandBinCounts[band]!);
    }
  }

  const salience = Array.from({ length: 3 }, () => new Float64Array(frameCount));
  const radius = Math.round(0.65 / frameSeconds);
  for (let band = 0; band < 3; band += 1) {
    const raw = bandFlux[band]!;
    const mean = movingMean(raw, radius);
    const meanSquares = movingMean(Float64Array.from(raw, (value) => value * value), radius);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const sigma = Math.sqrt(Math.max(0, meanSquares[frame]! - mean[frame]! ** 2));
      salience[band]![frame] = Math.max(
        0, (raw[frame]! - mean[frame]!) / Math.max(0.015, sigma) - 0.25,
      );
    }
  }

  const rmsAverage = movingMean(rms, Math.round(0.16 / frameSeconds));
  const onset = new Float64Array(frameCount);
  for (let frame = 1; frame < frameCount; frame += 1) {
    const attack = Math.max(0, rms[frame]! - rmsAverage[Math.max(0, frame - 1)]!);
    onset[frame] = salience[0]![frame]! * 0.43
      + salience[1]![frame]! * 0.35
      + salience[2]![frame]! * 0.25
      + Math.min(2, attack * 30) * 0.20;
  }
  const smooth = movingMean(onset, 1);
  const peaks: AnalysisPeak[] = [];
  const silenceFloor = Math.max(0.00012, percentile(rms, 0.85) * 0.045);
  for (let frame = 3; frame < frameCount - 3; frame += 1) {
    if (rms[frame]! < silenceFloor
      || smooth[frame]! < 0.67
      || smooth[frame]! < smooth[frame - 1]!
      || smooth[frame]! <= smooth[frame + 1]!) continue;
    let stronger = false;
    for (let nearby = Math.max(1, frame - 4); nearby <= Math.min(frameCount - 2, frame + 4); nearby += 1) {
      if (nearby !== frame && smooth[nearby]! > smooth[frame]!) {
        stronger = true;
        break;
      }
    }
    if (stronger) continue;
    const bandValues = salience.map((values) => values[frame]!);
    const dominant = bandValues.indexOf(Math.max(...bandValues));
    peaks.push({
      time: (frame * HOP + FFT_SIZE / 2) / sampleRate,
      strength: smooth[frame]!,
      band: dominant,
      bands: bandValues,
      rms: rms[frame]!,
    });
  }
  return {
    onset: smooth, peaks, rms, duration: samples.length / sampleRate,
    sampleRate, hopSize: HOP,
  };
}

function periodicity(analysis: AudioAnalysis, shift: number): number {
  let sum = 0;
  let firstPower = 0;
  let secondPower = 0;
  const integerShift = Math.floor(shift);
  const fraction = shift - integerShift;
  for (let index = 0; index + integerShift + 1 < analysis.onset.length; index += 2) {
    const first = analysis.onset[index]!;
    const second = analysis.onset[index + integerShift]! * (1 - fraction)
      + analysis.onset[index + integerShift + 1]! * fraction;
    sum += first * second;
    firstPower += first * first;
    secondPower += second * second;
  }
  return sum / (Math.sqrt(firstPower * secondPower) + 1e-8);
}

function phaseCoherence(peaks: readonly AnalysisPeak[], bpm: number): { score: number; phase: number } {
  const interval = 60 / bpm;
  let real = 0;
  let imaginary = 0;
  let secondReal = 0;
  let secondImaginary = 0;
  let total = 0;
  for (const peak of peaks) {
    const weight = Math.min(5, peak.strength);
    const angle = TWO_PI * ((peak.time % interval) / interval);
    real += Math.cos(angle) * weight;
    imaginary += Math.sin(angle) * weight;
    secondReal += Math.cos(2 * angle) * weight;
    secondImaginary += Math.sin(2 * angle) * weight;
    total += weight;
  }
  return {
    score: (Math.hypot(real, imaginary) * 0.7 + Math.hypot(secondReal, secondImaginary) * 0.3)
      / (total + 1e-8),
    phase: (((Math.atan2(imaginary, real) / TWO_PI) % 1 + 1) % 1) * interval,
  };
}

export function estimateTempo(
  analysis: AudioAnalysis, options: TempoOptions = {},
): TempoEstimate {
  const minBpm = options.minBpm ?? 75;
  const maxBpm = options.maxBpm ?? 205;
  let bpm = options.bpm;
  let confidence: number | null = null;
  const frameSeconds = analysis.hopSize / analysis.sampleRate;

  if (bpm === undefined) {
    const guesses: Array<{ bpm: number; score: number }> = [];
    for (let candidate = minBpm; candidate <= maxBpm; candidate += 0.5) {
      const lag = (60 / candidate) / frameSeconds;
      const score = periodicity(analysis, lag) * 0.7 + periodicity(analysis, lag * 2) * 0.3;
      guesses.push({ bpm: candidate, score });
    }
    guesses.sort((left, right) => right.score - left.score);
    let best = { score: -Infinity, bpm: guesses[0]?.bpm ?? minBpm };
    for (const guess of guesses.slice(0, 7)) {
      for (let candidate = Math.max(minBpm, guess.bpm - 2.5);
        candidate <= Math.min(maxBpm, guess.bpm + 2.5); candidate += 0.1) {
        const periodic = periodicity(analysis, (60 / candidate) / frameSeconds);
        const coherence = phaseCoherence(analysis.peaks, candidate).score;
        const score = periodic * 0.48 + coherence * 0.52 + 0.012 * Math.log2(candidate / 100);
        if (score > best.score) best = { score, bpm: candidate };
      }
    }
    bpm = round(best.bpm, 2);
    confidence = round(best.score, 3);
  }

  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('bpm must be positive');
  const phase = phaseCoherence(analysis.peaks, bpm);
  const interval = 60 / bpm;
  const offset = options.offset === undefined
    ? phase.phase
    : ((options.offset % interval) + interval) % interval;
  return { bpm, offset, confidence, phaseCoherence: round(phase.score, 3) };
}

export function createGridEvents(
  analysis: AudioAnalysis, tempo: TempoEstimate, subdivision: number,
): GridEvent[] {
  const beat = 60 / tempo.bpm;
  const unit = beat / subdivision;
  const peakBySlot = new Map<number, GridEvent>();
  const tolerance = Math.min(0.06, unit * 0.4);
  for (const peak of analysis.peaks) {
    const index = Math.round((peak.time - tempo.offset) / unit);
    const time = tempo.offset + index * unit;
    if (time < 0.04 || time > analysis.duration - 0.1
      || Math.abs(peak.time - time) > tolerance) continue;
    const alignment = Math.exp(-0.5 * ((peak.time - time) / (tolerance * 0.8)) ** 2);
    const strength = peak.strength * alignment;
    const existing = peakBySlot.get(index);
    if (!existing || strength > existing.strength) {
      peakBySlot.set(index, {
        index, time, sourceTime: peak.time, strength,
        band: peak.band, bands: peak.bands, rms: peak.rms,
      });
    }
  }
  return [...peakBySlot.values()].sort((left, right) => left.time - right.time);
}

export async function analyzeAudio(
  path: string,
  options: TempoOptions & { readonly ffmpegPath?: string } = {},
): Promise<{ readonly analysis: AudioAnalysis; readonly tempo: TempoEstimate }> {
  const samples = await decodeAudioToMono(path, { ffmpegPath: options.ffmpegPath });
  const analysis = analyzeSamples(samples);
  return { analysis, tempo: estimateTempo(analysis, options) };
}

export async function hashDecodedAudio(
  path: string, options: { readonly ffmpegPath?: string } = {},
): Promise<string> {
  const samples = await decodeAudioToMono(path, options);
  const bytes = Buffer.allocUnsafe(samples.length * 4);
  for (let index = 0; index < samples.length; index += 1) {
    bytes.writeFloatLE(samples[index]!, index * 4);
  }
  return createHash('sha256').update(bytes).digest('hex');
}
