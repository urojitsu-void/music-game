import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'assets');

function sphere(colors: readonly [string, string, string], direction?: 'left' | 'right' | 'up' | 'down') {
  const canvas = createCanvas(256, 256);
  const context = canvas.getContext('2d');
  const glow = context.createRadialGradient(128, 128, 88, 128, 128, 126);
  glow.addColorStop(0, `${colors[1]}66`);
  glow.addColorStop(1, `${colors[2]}00`);
  context.fillStyle = glow;
  context.beginPath(); context.arc(128, 128, 124, 0, Math.PI * 2); context.fill();
  const body = context.createRadialGradient(82, 65, 5, 128, 128, 106);
  body.addColorStop(0, '#ffffff'); body.addColorStop(0.16, colors[0]);
  body.addColorStop(0.5, colors[1]); body.addColorStop(0.82, colors[2]); body.addColorStop(1, '#090b20');
  context.fillStyle = body;
  context.beginPath(); context.arc(128, 128, 103, 0, Math.PI * 2); context.fill();
  context.save(); context.beginPath(); context.arc(128, 128, 103, 0, Math.PI * 2); context.clip();
  const lowerShade = context.createLinearGradient(0, 92, 0, 226);
  lowerShade.addColorStop(0, 'rgba(0,0,0,0)'); lowerShade.addColorStop(1, 'rgba(0,0,30,0.58)');
  context.fillStyle = lowerShade; context.fillRect(20, 80, 216, 150); context.restore();
  context.strokeStyle = 'rgba(255,255,255,0.72)'; context.lineWidth = 4;
  context.beginPath(); context.arc(128, 128, 103, 0, Math.PI * 2); context.stroke();
  context.fillStyle = 'rgba(255,255,255,0.82)';
  context.beginPath(); context.ellipse(91, 76, 34, 18, -0.55, 0, Math.PI * 2); context.fill();
  context.fillStyle = 'rgba(255,255,255,0.22)';
  context.beginPath(); context.ellipse(151, 187, 46, 13, -0.15, 0, Math.PI * 2); context.fill();
  if (direction) drawArrow(context, direction);
  return canvas.toBuffer('image/png');
}

function drawArrow(context: SKRSContext2D, direction: 'left' | 'right' | 'up' | 'down'): void {
  const angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[direction];
  context.save(); context.translate(128, 128); context.rotate(angle);
  const arrow = context.createLinearGradient(-55, -48, 62, 48);
  arrow.addColorStop(0, '#ffffff'); arrow.addColorStop(0.48, '#fff5a8'); arrow.addColorStop(1, '#ff9d00');
  context.fillStyle = arrow; context.strokeStyle = '#351000'; context.lineWidth = 9;
  context.beginPath(); context.moveTo(62, 0); context.lineTo(6, -48); context.lineTo(6, -22);
  context.lineTo(-55, -22); context.lineTo(-55, 22); context.lineTo(6, 22);
  context.lineTo(6, 48); context.closePath(); context.stroke(); context.fill(); context.restore();
}

function textAsset(text: string, colors: readonly [string, string], width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(0.48, '#ffffff');
  gradient.addColorStop(0.55, colors[0]); gradient.addColorStop(1, colors[1]);
  context.font = `900 ${Math.floor(height * 0.66)}px "Avenir Next"`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.strokeStyle = '#09040b'; context.lineWidth = height * 0.12;
  context.strokeText(text, width / 2, height / 2);
  context.fillStyle = gradient; context.fillText(text, width / 2, height / 2);
  return canvas.toBuffer('image/png');
}

function rainbowBar(): Buffer {
  const canvas = createCanvas(1024, 48);
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 1024, 0);
  ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#651fff', '#f500d4']
    .forEach((color, index, values) => gradient.addColorStop(index / (values.length - 1), color));
  context.fillStyle = gradient; context.fillRect(0, 0, 1024, 48);
  context.fillStyle = 'rgba(255,255,255,0.45)'; context.fillRect(0, 0, 1024, 10);
  return canvas.toBuffer('image/png');
}

function rainbowBarGlow(): Buffer {
  const canvas = createCanvas(1024, 128);
  const context = canvas.getContext('2d');
  const source = createCanvas(1024, 128);
  const sourceContext = source.getContext('2d');
  const rainbow = sourceContext.createLinearGradient(0, 0, 1024, 0);
  ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#651fff', '#f500d4']
    .forEach((color, index, values) => rainbow.addColorStop(index / (values.length - 1), color));
  sourceContext.fillStyle = rainbow; sourceContext.fillRect(0, 52, 1024, 24);
  context.filter = 'blur(22px)';
  context.globalAlpha = 0.96;
  context.drawImage(source, 0, 0);
  context.filter = 'blur(9px)';
  context.drawImage(source, 0, 0);
  return canvas.toBuffer('image/png');
}

function hitRing(): Buffer {
  const canvas = createCanvas(512, 512);
  const context = canvas.getContext('2d');
  context.lineWidth = 38;
  for (let degree = 0; degree < 360; degree += 2) {
    const start = (degree - 90) * Math.PI / 180;
    const end = (degree - 87.4) * Math.PI / 180;
    context.strokeStyle = `hsl(${degree} 100% 58%)`;
    context.beginPath();
    context.arc(256, 256, 205, start, end);
    context.stroke();
  }
  context.strokeStyle = 'rgba(255,255,255,0.78)'; context.lineWidth = 7;
  context.beginPath(); context.arc(256, 256, 205, 0, Math.PI * 2); context.stroke();
  return canvas.toBuffer('image/png');
}

await mkdir(OUTPUT, { recursive: true });
await Promise.all([
  writeFile(join(OUTPUT, 'note-tap.png'), sphere(['#d9fbff', '#28dfff', '#004f8f'])),
  writeFile(join(OUTPUT, 'note-hold.png'), sphere(['#ffe0fb', '#ff3fcf', '#73005d'])),
  ...(['left', 'right', 'up', 'down'] as const).map((direction) =>
    writeFile(join(OUTPUT, `note-flick-${direction}.png`), sphere(['#fffbd0', '#ffc928', '#9d4800'], direction))),
  writeFile(join(OUTPUT, 'full-combo.png'), textAsset('FULL COMBO', ['#fff177', '#e32572'], 900, 190)),
  writeFile(join(OUTPUT, 'rainbow-bar.png'), rainbowBar()),
  writeFile(join(OUTPUT, 'rainbow-bar-glow.png'), rainbowBarGlow()),
  writeFile(join(OUTPUT, 'hit-ring.png'), hitRing()),
]);
