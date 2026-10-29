import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectNote, resolveLayout } from '../src/render/geometry.ts';

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

test('note reaches top and target with linearly growing radius', () => {
  const layout = resolveLayout(normalized, 1280, 720);
  const top = projectNote(layout, 2, 0);
  const middle = projectNote(layout, 2, 0.5);
  const target = projectNote(layout, 2, 1);
  assert.equal(top.y, layout.topY);
  assert.equal(target.y, layout.judgmentY);
  close(middle.y, (top.y + target.y) / 2);
  close(middle.radius, (top.radius + target.radius) / 2);
  assert(top.radius < target.radius);
});
