import { validateChart } from '../chart/validation.ts';
import type { PlayableSong } from './song-source.ts';

export interface DataPlaylistSong {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly background: string;
  readonly chart: string;
  readonly thumbnail?: string;
}

export interface DataPlaylist {
  readonly formatVersion: 1;
  readonly version?: string;
  readonly songs: readonly DataPlaylistSong[];
}

export interface ReleaseCatalogSong extends DataPlaylistSong {
  readonly thumbnailUrl: string | null;
}

export interface ReleaseCatalog {
  readonly playlistUrl: string;
  readonly version: string;
  readonly songs: readonly ReleaseCatalogSong[];
}

export type FetchJson = (url: string) => Promise<unknown>;

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function httpsAssetUrl(value: string): URL | null {
  if (!value.startsWith('https://')) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError(`${value} must be a safe HTTPS asset URL`);
  }
  return url;
}

export function flattenReleaseAssetPath(path: string): string {
  if (path.startsWith('/') || path.includes('\\')) {
    throw new TypeError(`${path} must be a safe relative data path`);
  }
  const segments = path.split('/');
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`${path} must be a safe relative data path`);
  }
  if (segments.some((segment) => segment.includes('__'))) {
    throw new TypeError(`${path} cannot contain a double underscore`);
  }
  return [...segments.join('__')].map((character) => (
    /^[A-Za-z0-9._-]$/.test(character)
      ? character
      : `_u${character.codePointAt(0)!.toString(16)}_`
  )).join('');
}

export function validateDataPlaylist(value: unknown, requireVersion = false): DataPlaylist {
  const input = object(value, 'playlist');
  if (input.formatVersion !== 1) throw new RangeError('playlist.formatVersion must be 1');
  if (!Array.isArray(input.songs)) throw new TypeError('playlist.songs must be an array');
  const version = input.version === undefined ? undefined : text(input.version, 'playlist.version');
  if (requireVersion && version === undefined) {
    throw new TypeError('playlist.version must be a non-empty string');
  }
  const ids = new Set<string>();
  const assets = new Map<string, string>();
  const songs = input.songs.map((valueSong, index): DataPlaylistSong => {
    const path = `playlist.songs[${index}]`;
    const song = object(valueSong, path);
    const id = text(song.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`duplicate song id: ${id}`);
    ids.add(id);
    const paths = {
      background: text(song.background, `${path}.background`),
      chart: text(song.chart, `${path}.chart`),
      ...(song.thumbnail === undefined ? {} : { thumbnail: text(song.thumbnail, `${path}.thumbnail`) }),
    };
    for (const dataPath of Object.values(paths)) {
      const key = httpsAssetUrl(dataPath)?.href ?? flattenReleaseAssetPath(dataPath);
      const previous = assets.get(key);
      if (previous && previous !== dataPath) {
        throw new Error(`data paths ${previous} and ${dataPath} map to the same release asset`);
      }
      assets.set(key, dataPath);
    }
    return {
      id,
      title: text(song.title, `${path}.title`),
      ...(song.artist === undefined ? {} : { artist: text(song.artist, `${path}.artist`) }),
      ...paths,
    };
  });
  return { formatVersion: 1, ...(version === undefined ? {} : { version }), songs };
}

export function releaseAssetUrl(playlistUrl: string, dataPath: string, version: string): string {
  const direct = httpsAssetUrl(dataPath);
  if (direct) {
    direct.searchParams.set('v', version);
    return direct.href;
  }
  const assetName = encodeURIComponent(flattenReleaseAssetPath(dataPath));
  if (playlistUrl.startsWith('/')) {
    const directory = playlistUrl.slice(0, playlistUrl.lastIndexOf('/') + 1);
    return `${directory}${assetName}?v=${encodeURIComponent(version)}`;
  }
  const base = new URL('.', playlistUrl);
  const asset = new URL(assetName, base);
  asset.searchParams.set('v', version);
  return asset.href;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function loadReleaseCatalog(
  playlistUrl: string,
  fetchJson: FetchJson = defaultFetchJson,
): Promise<ReleaseCatalog> {
  const playlist = validateDataPlaylist(await fetchJson(playlistUrl), true);
  const version = playlist.version!;
  return {
    playlistUrl,
    version,
    songs: playlist.songs.map((song) => ({
      ...song,
      thumbnailUrl: song.thumbnail
        ? releaseAssetUrl(playlistUrl, song.thumbnail, version) : null,
    })),
  };
}

export async function loadReleaseSong(
  catalog: ReleaseCatalog,
  entry: ReleaseCatalogSong,
  fetchJson: FetchJson = defaultFetchJson,
): Promise<PlayableSong> {
  const chartUrl = releaseAssetUrl(catalog.playlistUrl, entry.chart, catalog.version);
  const chart = validateChart(await fetchJson(chartUrl));
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist ?? null,
    thumbnailUrl: entry.thumbnailUrl,
    backgroundVideoUrl: releaseAssetUrl(
      catalog.playlistUrl, entry.background, catalog.version,
    ),
    chart,
    dispose: () => undefined,
  };
}
