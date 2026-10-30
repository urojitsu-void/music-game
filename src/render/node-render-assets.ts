import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadImage } from '@napi-rs/canvas';

import type { RasterAsset, RenderAssets } from './canvas-renderer.ts';

const DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'assets');

async function asset(name: string): Promise<RasterAsset> {
  const image = await loadImage(join(DIRECTORY, name));
  return { image, width: image.width, height: image.height };
}

export async function loadNodeRenderAssets(): Promise<RenderAssets> {
  const [tap, hold, left, right, up, down, combo, comboGlow, perfect, fullCombo, gauge, gaugeGlow, hitRing] = await Promise.all([
    asset('note-tap.png'), asset('note-hold.png'),
    asset('note-flick-left.png'), asset('note-flick-right.png'),
    asset('note-flick-up.png'), asset('note-flick-down.png'),
    asset('combo.png'), asset('combo-glow.png'), asset('perfect.png'), asset('full-combo.png'), asset('rainbow-bar.png'),
    asset('rainbow-bar-glow.png'),
    asset('hit-ring.png'),
  ]);
  return { tap, hold, flick: { left, right, up, down }, combo, comboGlow, perfect, fullCombo, gauge, gaugeGlow, hitRing };
}
