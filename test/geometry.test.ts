import assert from 'node:assert/strict';
import { test } from 'node:test';

import { perspectiveProgress, projectNote, resolveLayout } from '../src/render/geometry.ts';

const normalized = { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 };
const close = (actual: number, expected: number) => assert(Math.abs(actual - expected) < 1e-9);

test('resolveLayout converts normalized geometry at 1280x720', () => {
  const layout = resolveLayout(normalized, 1280, 720);
  assert.equal(layout.topCenterX, 640);
  close(layout.topY, 100.8);
  assert.equal(layout.judgmentCenterX, 640);
  close(layout.judgmentY, 590.4);
  close(layout.judgmentWidth, 742.4);
  close(layout.topWidth, 742.4 * 0.42);
});

test('resolveLayout scales consistently at 1920x1080', () => {
  const layout = resolveLayout(normalized, 1920, 1080);
  assert.equal(layout.topCenterX, 960);
  close(layout.judgmentY, 885.6);
  close(layout.judgmentWidth, 1113.6);
  close(layout.topWidth, 1113.6 * 0.42);
});

test('lane centers converge to 42 percent width at the top', () => {
  const layout = resolveLayout(normalized, 1000, 1000);
  const topLeft = projectNote(layout, 0, 0);
  const topRight = projectNote(layout, 3, 0);
  const bottomLeft = projectNote(layout, 0, 1);
  const bottomRight = projectNote(layout, 3, 1);
  close((topRight.x - topLeft.x) / (bottomRight.x - bottomLeft.x), 0.42);
});

test('perspective progress preserves endpoints and increases monotonically', () => {
  assert.equal(perspectiveProgress(0), 0);
  assert.equal(perspectiveProgress(1), 1);

  const projected = [0, 0.25, 0.5, 0.75, 1].map(perspectiveProgress);
  for (let index = 1; index < projected.length; index += 1) {
    assert(projected[index] > projected[index - 1]);
  }
  close(perspectiveProgress(0.5), 0.65 * 0.5 + 0.35 * 0.5 ** 3);
});

test('note reaches top and target with perspective-scaled position and radius', () => {
  const layout = resolveLayout(normalized, 1280, 720);
  const top = projectNote(layout, 2, 0);
  const middle = projectNote(layout, 2, 0.5);
  const target = projectNote(layout, 2, 1);
  const easedMiddle = 0.65 * 0.5 + 0.35 * 0.5 ** 3;
  assert.equal(top.y, layout.topY);
  assert.equal(target.y, layout.judgmentY);
  close(middle.y, top.y + (target.y - top.y) * easedMiddle);
  close(middle.radius, top.radius + (target.radius - top.radius) * easedMiddle);
  assert(top.radius < target.radius);
});

test('late notes remain separated by more than 2.1 combined radii', () => {
  const layout = resolveLayout(normalized, 1280, 720);

  for (const [firstProgress, secondProgress] of [[0.8, 0.9], [0.9, 1.0]]) {
    const first = projectNote(layout, 2, firstProgress);
    const second = projectNote(layout, 2, secondProgress);
    const centerDistance = Math.hypot(second.x - first.x, second.y - first.y);
    assert(
      centerDistance > 2.1 * (first.radius + second.radius),
      `notes at ${firstProgress}/${secondProgress} overlap: ${centerDistance}`,
    );
  }
});

test('250 millisecond note spacing prevents asset overlap across the full travel path', () => {
  const layout = resolveLayout(normalized, 1280, 720);
  const progressGap = 0.25 / 2;
  for (let frontProgress = progressGap; frontProgress <= 1; frontProgress += 0.001) {
    const front = projectNote(layout, 2, frontProgress);
    const back = projectNote(layout, 2, frontProgress - progressGap);
    const centerDistance = Math.hypot(front.x - back.x, front.y - back.y);
    assert(centerDistance > 2.1 * (front.radius + back.radius));
  }
});
