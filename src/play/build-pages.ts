import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundlePlayApp, type PlayBundle } from './build-browser.ts';
import { DEFAULT_PLAYLIST_URL } from './data-config.ts';
import {
  buildPagesData,
  type BuildPagesDataOptions,
  type PagesDataResult,
} from './pages-data.ts';

export interface BuildPagesAppOptions extends Omit<BuildPagesDataOptions, 'playlistUrl'> {
  readonly playlistUrl?: string;
}

export interface PagesAppResult {
  readonly bundle: PlayBundle;
  readonly data: PagesDataResult;
}

export async function buildPagesApp(options: BuildPagesAppOptions): Promise<PagesAppResult> {
  await rm(options.outputDirectory, { recursive: true, force: true });
  const bundle = await bundlePlayApp(options.outputDirectory);
  const data = await buildPagesData({
    outputDirectory: join(options.outputDirectory, 'data'),
    playlistUrl: options.playlistUrl ?? DEFAULT_PLAYLIST_URL,
    fetchJson: options.fetchJson,
  });
  await writeFile(join(options.outputDirectory, '.nojekyll'), '', 'utf8');
  return { bundle, data };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = resolve(process.cwd(), 'dist/play');
  await buildPagesApp({ outputDirectory });
  process.stdout.write(`${outputDirectory}\n`);
}
