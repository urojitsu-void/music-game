import type { RasterAsset, RenderAssets } from './canvas-renderer.ts';

function asset(name: string): Promise<RasterAsset> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Failed to load renderer asset: ${name}`));
    image.src = `assets/${name}`;
  });
}

export async function loadBrowserRenderAssets(): Promise<RenderAssets> {
  const [tap, hold, left, right, up, down, perfect, fullCombo, gauge, gaugeGlow, hitRing] = await Promise.all([
    asset('note-tap.png'), asset('note-hold.png'),
    asset('note-flick-left.png'), asset('note-flick-right.png'),
    asset('note-flick-up.png'), asset('note-flick-down.png'),
    asset('perfect.png'), asset('full-combo.png'),
    asset('rainbow-bar.png'), asset('rainbow-bar-glow.png'), asset('hit-ring.png'),
  ]);
  return { tap, hold, flick: { left, right, up, down }, perfect, fullCombo, gauge, gaugeGlow, hitRing };
}
