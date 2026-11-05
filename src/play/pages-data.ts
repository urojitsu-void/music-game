import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateChart } from '../chart/validation.ts';
import {
  releaseAssetUrl,
  validateDataPlaylist,
  type DataPlaylist,
  type FetchJson,
} from './release-catalog.ts';

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export interface BuildPagesDataOptions {
  readonly outputDirectory: string;
  readonly playlistUrl: string;
  readonly fetchJson?: FetchJson;
}

export interface PagesDataResult {
  readonly playlistPath: string;
  readonly chartPaths: readonly string[];
}

export async function buildPagesData(
  options: BuildPagesDataOptions,
): Promise<PagesDataResult> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const source = validateDataPlaylist(await fetchJson(options.playlistUrl), true);
  await mkdir(options.outputDirectory, { recursive: true });
  const chartPaths: string[] = [];
  const songs = [];

  for (const [index, song] of source.songs.entries()) {
    const chartName = `chart-${index}.json`;
    const chartUrl = releaseAssetUrl(options.playlistUrl, song.chart, source.version!);
    const chart = validateChart(await fetchJson(chartUrl));
    const chartPath = join(options.outputDirectory, chartName);
    await writeFile(chartPath, `${JSON.stringify(chart, null, 2)}\n`, 'utf8');
    chartPaths.push(chartPath);
    songs.push({
      ...song,
      background: releaseAssetUrl(options.playlistUrl, song.background, source.version!),
      chart: chartName,
      ...(song.thumbnail ? {
        thumbnail: releaseAssetUrl(options.playlistUrl, song.thumbnail, source.version!),
      } : {}),
    });
  }

  const playlist: DataPlaylist = {
    formatVersion: 1,
    version: source.version,
    songs,
  };
  validateDataPlaylist(playlist, true);
  const playlistPath = join(options.outputDirectory, 'playlist.json');
  await writeFile(playlistPath, `${JSON.stringify(playlist, null, 2)}\n`, 'utf8');
  return { playlistPath, chartPaths };
}
