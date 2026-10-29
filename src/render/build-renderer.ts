import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export interface RendererBundle {
  readonly root: string;
  readonly htmlPath: string;
  readonly scriptPath: string;
}

export async function bundleRenderer(outputDirectory: string): Promise<RendererBundle> {
  await mkdir(outputDirectory, { recursive: true });
  const htmlPath = join(outputDirectory, 'renderer.html');
  const scriptPath = join(outputDirectory, 'renderer.js');
  await Promise.all([
    copyFile(join(SOURCE_DIRECTORY, 'renderer.html'), htmlPath),
    build({
      entryPoints: [join(SOURCE_DIRECTORY, 'renderer-app.tsx')],
      outfile: scriptPath,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome120'],
      sourcemap: false,
      minify: false,
      logLevel: 'silent',
    }),
  ]);
  return { root: outputDirectory, htmlPath, scriptPath };
}
