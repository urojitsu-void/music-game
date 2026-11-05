import { copyFile, cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RENDER_DIRECTORY = resolve(SOURCE_DIRECTORY, '../render');

export interface PlayBundle {
  readonly root: string;
  readonly htmlPath: string;
  readonly scriptPath: string;
  readonly cssPath: string;
}

export async function bundlePlayApp(outputDirectory: string): Promise<PlayBundle> {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(join(outputDirectory, 'assets'), { recursive: true });
  const htmlPath = join(outputDirectory, 'index.html');
  const scriptPath = join(outputDirectory, 'play.js');
  const cssPath = join(outputDirectory, 'play.css');
  await Promise.all([
    copyFile(join(SOURCE_DIRECTORY, 'index.html'), htmlPath),
    copyFile(join(SOURCE_DIRECTORY, 'play.css'), cssPath),
    copyFile(
      join(SOURCE_DIRECTORY, 'assets', 'song-select-background.png'),
      join(outputDirectory, 'assets', 'song-select-background.png'),
    ),
    cp(join(RENDER_DIRECTORY, 'assets'), join(outputDirectory, 'assets'), { recursive: true }),
    build({
      entryPoints: [join(SOURCE_DIRECTORY, 'browser-entry.tsx')],
      outfile: scriptPath,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome120', 'safari17'],
      sourcemap: true,
      minify: false,
      logLevel: 'silent',
    }),
  ]);
  return { root: outputDirectory, htmlPath, scriptPath, cssPath };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = resolve(process.cwd(), 'dist/play');
  await bundlePlayApp(outputDirectory);
  process.stdout.write(`${outputDirectory}\n`);
}
