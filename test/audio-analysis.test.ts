import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  analyzeSamples,
  decodeAudioToMono,
  estimateTempo,
  hashDecodedAudio,
} from '../src/chart/audio-analysis.ts';

const SAMPLE_RATE = 11025;
const DURATION = 36;

function clickTrack(bpm: number): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * DURATION);
  const beat = 60 / bpm;
  let beatIndex = 0;
  for (let time = 4; time < 32; time += beat, beatIndex += 1) {
    const amplitude = beatIndex % 4 === 0 ? 1 : 0.65;
    addClick(samples, time, 0.020, amplitude, 260);
    addClick(samples, time + beat / 2, 0.008, 0.18, 3200);
  }
  return samples;
}

function addClick(
  samples: Float32Array, time: number, duration: number, amplitude: number, frequency: number,
): void {
  const start = Math.round(time * SAMPLE_RATE);
  const length = Math.round(duration * SAMPLE_RATE);
  for (let index = 0; index < length && start + index < samples.length; index += 1) {
    const envelope = Math.exp(-index / (SAMPLE_RATE * duration * 0.16));
    const carrier = index === 0 ? 1 : Math.cos(2 * Math.PI * frequency * index / SAMPLE_RATE);
    samples[start + index] += amplitude * envelope * carrier;
  }
}

for (const bpm of [110, 128, 156, 170]) {
  test(`analysis rejects silence and estimates ${bpm} BPM`, () => {
    const analysis = analyzeSamples(clickTrack(bpm));
    assert(analysis.peaks.length > 20);
    assert(analysis.peaks.every((peak) => peak.time >= 3.9 && peak.time <= 32.1));
    for (let index = 1; index < analysis.peaks.length; index += 1) {
      assert(analysis.peaks[index]!.time > analysis.peaks[index - 1]!.time);
    }
    const tempo = estimateTempo(analysis, {});
    assert(Math.abs(tempo.bpm - bpm) <= 1, `expected ${bpm}, got ${tempo.bpm}`);
  });
}

test('estimateTempo honors explicit BPM and normalized offset', () => {
  const analysis = analyzeSamples(clickTrack(128));
  const tempo = estimateTempo(analysis, { bpm: 128, offset: 0.7 });
  assert.equal(tempo.bpm, 128);
  assert(Math.abs(tempo.offset - 0.23125) < 1e-12);
  assert.equal(tempo.confidence, null);
});

function pcm16Wav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]!));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

test('decodeAudioToMono decodes canonical samples and hashDecodedAudio is content-stable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'audio-analysis-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new Float32Array(SAMPLE_RATE * 2);
  first[100] = 0.5;
  first[1000] = -0.25;
  const second = first.slice();
  second[1000] = -0.5;
  const firstPath = join(directory, 'first.wav');
  const secondPath = join(directory, 'second.wav');
  await writeFile(firstPath, pcm16Wav(first));
  await writeFile(secondPath, pcm16Wav(second));

  const decoded = await decodeAudioToMono(firstPath, { ffmpegPath: 'ffmpeg' });
  assert.equal(decoded.length, first.length);
  assert(Math.abs(decoded.length / SAMPLE_RATE - 2) <= 1 / SAMPLE_RATE);
  assert(Math.abs(decoded[100]! - 0.5) <= 1 / 32768);
  assert(Math.abs(decoded[1000]! + 0.25) <= 1 / 32768);

  const hash1 = await hashDecodedAudio(firstPath, { ffmpegPath: 'ffmpeg' });
  const hash2 = await hashDecodedAudio(firstPath, { ffmpegPath: 'ffmpeg' });
  const changedHash = await hashDecodedAudio(secondPath, { ffmpegPath: 'ffmpeg' });
  assert.equal(hash1, hash2);
  assert.notEqual(hash1, changedHash);
  assert.match(hash1, /^[a-f0-9]{64}$/);
});
