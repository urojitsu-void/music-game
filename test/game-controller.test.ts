import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chart } from '../src/chart/schema.ts';
import { createGameController } from '../src/play/game-controller.ts';
import type { PlayableSong } from '../src/play/song-source.ts';

function chart(): Chart {
  return {
    formatVersion: 1,
    audio: 'song.mp3',
    duration: 3,
    bpm: 120,
    beatOffset: 0,
    beatsPerBar: 4,
    difficulty: 'normal',
    lanes: 4,
    seed: 1,
    notes: [{ type: 'tap', time: 1, lane: 0 }],
    statistics: {},
  };
}

function song(dispose = () => undefined): PlayableSong {
  return {
    id: 'song',
    title: 'Song',
    artist: null,
    thumbnailUrl: null,
    backgroundVideoUrl: 'blob:song',
    chart: chart(),
    dispose,
  };
}

test('game controller transitions setup to ready to playing', async () => {
  const media = { currentTime: 0, play: async () => undefined, pause: () => undefined };
  const controller = createGameController(media);
  assert.equal(controller.snapshot.phase, 'setup');

  controller.load(song());
  assert.equal(controller.snapshot.phase, 'ready');
  await controller.start();

  assert.equal(controller.snapshot.phase, 'playing');
});

test('game controller advances only from media currentTime', async () => {
  const media = { currentTime: 0, play: async () => undefined, pause: () => undefined };
  const controller = createGameController(media);
  controller.load(song());
  await controller.start();

  media.currentTime = 1.25;
  controller.tick();

  assert.equal(controller.snapshot.game?.currentTime, 1.25);
});

test('game controller pauses on interruption and resynchronizes on explicit resume', async () => {
  let pauseCalls = 0;
  const media = {
    currentTime: 0,
    play: async () => undefined,
    pause: () => { pauseCalls += 1; },
  };
  const controller = createGameController(media);
  controller.load(song());
  await controller.start();

  media.currentTime = 0.75;
  controller.interrupt('hidden');
  assert.equal(controller.snapshot.phase, 'paused');
  assert.equal(controller.snapshot.pauseReason, 'hidden');
  assert.equal(pauseCalls, 1);

  media.currentTime = 1.1;
  await controller.resume();
  assert.equal(controller.snapshot.phase, 'playing');
  assert.equal(controller.snapshot.game?.currentTime, 1.1);
});

test('game controller judges input against an explicit video-clock time', async () => {
  const media = { currentTime: 0, play: async () => undefined, pause: () => undefined };
  const controller = createGameController(media);
  controller.load(song());
  await controller.start();

  const result = controller.inputAt({ action: 'press', lane: 0 }, 1.08);

  assert.equal(result?.judgment, 'GREAT');
  assert.equal(controller.snapshot.game?.score, 700);
});

test('game controller shows rank before optional FULL COMBO result', async () => {
  const media = { currentTime: 1, play: async () => undefined, pause: () => undefined };
  const controller = createGameController(media);
  controller.load(song());
  await controller.start();
  controller.inputAt({ action: 'press', lane: 0 }, 1);

  controller.finish();
  assert.equal(controller.snapshot.phase, 'result');
  assert.equal(controller.snapshot.resultStage, 'rank');
  assert.equal(controller.snapshot.game?.rank, 'S');

  controller.revealFullCombo();
  assert.equal(controller.snapshot.resultStage, 'full-combo');
});

test('game controller does not reveal FULL COMBO after a broken combo', async () => {
  const media = { currentTime: 1.13, play: async () => undefined, pause: () => undefined };
  const controller = createGameController(media);
  controller.load(song());
  await controller.start();
  controller.inputAt({ action: 'press', lane: 0 }, 1.13);
  controller.finish();

  controller.revealFullCombo();

  assert.equal(controller.snapshot.resultStage, 'rank');
});

test('game controller disposes the previous song when returning to setup', () => {
  let disposeCalls = 0;
  const media = { currentTime: 0, play: async () => undefined, pause: () => undefined };
  const controller = createGameController(media);
  controller.load(song(() => { disposeCalls += 1; }));

  controller.reset();

  assert.equal(controller.snapshot.phase, 'setup');
  assert.equal(disposeCalls, 1);
});
