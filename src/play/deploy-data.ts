import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { validateChart } from '../chart/validation.ts';
import { flattenReleaseAssetPath, type DataPlaylist } from './release-catalog.ts';

export interface DataReleaseConfig {
  readonly repository: string;
  readonly tag: string;
}

export interface DeploymentAsset {
  readonly name: string;
  readonly path: string;
  readonly sourcePath: string | null;
}

export interface PreparedDataDeployment {
  readonly release: DataReleaseConfig;
  readonly playlistUrl: string;
  readonly assets: readonly DeploymentAsset[];
  cleanup(): Promise<void>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout?: string;
}

export type CommandRunner = (
  command: string, args: readonly string[],
) => Promise<CommandResult>;

export interface DeploymentResult {
  readonly uploaded: boolean;
  readonly summary: readonly string[];
}

async function filesBelow(directory: string, current = directory): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(directory, path));
    else if (entry.isFile()) files.push(relative(directory, path));
  }
  return files;
}

async function requiredFile(path: string, relativePath: string): Promise<void> {
  try {
    if ((await stat(path)).isFile()) return;
  } catch {
    // Report the stable data-relative path below.
  }
  throw new Error(`song directory is missing required data file: ${relativePath}`);
}

async function generatePlaylist(dataDirectory: string): Promise<DataPlaylist> {
  const entries = await readdir(dataDirectory, { withFileTypes: true });
  const songDirectories = entries.filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const songs = [];
  for (const entry of songDirectories) {
    const id = entry.name;
    const background = `${id}/background.mp4`;
    const chartPath = `${id}/chart.json`;
    await requiredFile(join(dataDirectory, background), background);
    await requiredFile(join(dataDirectory, chartPath), chartPath);
    const chart = validateChart(JSON.parse(
      await readFile(join(dataDirectory, chartPath), 'utf8'),
    ) as unknown);
    const candidates = ['thumbnail.jpg', 'thumbnail.jpeg', 'thumbnail.png'];
    let thumbnail: string | undefined;
    for (const candidate of candidates) {
      try {
        if ((await stat(join(dataDirectory, id, candidate))).isFile()) {
          thumbnail = `${id}/${candidate}`;
          break;
        }
      } catch {
        // Optional thumbnail is absent.
      }
    }
    songs.push({
      id,
      title: chart.audio.replace(/\.[^.]+$/, ''),
      background,
      chart: chartPath,
      ...(thumbnail ? { thumbnail } : {}),
    });
  }
  return { formatVersion: 1, songs };
}

export async function prepareDataDeployment({
  dataDirectory,
  release,
  now = new Date(),
}: {
  readonly dataDirectory: string;
  readonly release: DataReleaseConfig;
  readonly now?: Date;
}): Promise<PreparedDataDeployment> {
  const sourcePlaylistPath = join(dataDirectory, 'playlist.json');
  const playlist = await generatePlaylist(dataDirectory);
  await writeFile(sourcePlaylistPath, `${JSON.stringify(playlist, null, 2)}\n`, 'utf8');
  const sourceFiles = await filesBelow(dataDirectory);

  const stagingDirectory = await mkdtemp(join(tmpdir(), 'music-game-data-release-'));
  try {
    const assets: DeploymentAsset[] = [];
    const names = new Set<string>();
    for (const sourceRelativePath of sourceFiles) {
      if (sourceRelativePath === 'playlist.json' || sourceRelativePath === 'release.json') continue;
      const name = flattenReleaseAssetPath(sourceRelativePath);
      if (names.has(name)) throw new Error(`duplicate release asset name: ${name}`);
      names.add(name);
      const stagedPath = join(stagingDirectory, name);
      await copyFile(join(dataDirectory, sourceRelativePath), stagedPath);
      assets.push({ name, path: stagedPath, sourcePath: sourceRelativePath });
    }
    const publicPlaylistPath = join(stagingDirectory, 'playlist.json');
    await writeFile(publicPlaylistPath, `${JSON.stringify({
      ...playlist,
      version: now.toISOString(),
    }, null, 2)}\n`, 'utf8');
    assets.push({ name: 'playlist.json', path: publicPlaylistPath, sourcePath: null });
    return {
      release,
      playlistUrl: `https://github.com/${release.repository}/releases/download/${encodeURIComponent(release.tag)}/playlist.json`,
      assets,
      cleanup: () => rm(stagingDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function deployPreparedData(
  deployment: PreparedDataDeployment,
  options: { readonly dryRun: boolean; readonly run: CommandRunner },
): Promise<DeploymentResult> {
  const summary = [
    `release: ${deployment.release.repository}@${deployment.release.tag}`,
    ...deployment.assets.map((asset) => `asset: ${asset.name}`),
    `playlist: ${deployment.playlistUrl}`,
  ];
  if (options.dryRun) return { uploaded: false, summary };

  const common = ['--repo', deployment.release.repository] as const;
  const viewed = await options.run('gh', [
    'release', 'view', deployment.release.tag, ...common, '--json', 'assets',
  ]);
  if (viewed.exitCode !== 0) {
    const created = await options.run('gh', [
      'release', 'create', deployment.release.tag, ...common,
      '--title', 'Game Data', '--notes', 'Music game data assets', '--latest=false',
    ]);
    if (created.exitCode !== 0) {
      throw new Error(`Failed to create GitHub Release: ${created.stderr}`);
    }
  } else if (viewed.stdout) {
    const release = JSON.parse(viewed.stdout) as { assets?: Array<{ name?: unknown }> };
    const desiredNames = new Set(deployment.assets.map((asset) => asset.name));
    const staleNames = (release.assets ?? [])
      .map((asset) => asset.name)
      .filter((name): name is string => typeof name === 'string' && !desiredNames.has(name));
    for (const name of staleNames) {
      const deleted = await options.run('gh', [
        'release', 'delete-asset', deployment.release.tag, name, ...common, '--yes',
      ]);
      if (deleted.exitCode !== 0) {
        throw new Error(`Failed to delete stale game data asset ${name}: ${deleted.stderr}`);
      }
    }
  }
  const uploaded = await options.run('gh', [
    'release', 'upload', deployment.release.tag,
    ...deployment.assets.map((asset) => asset.path),
    ...common,
    '--clobber',
  ]);
  if (uploaded.exitCode !== 0) {
    throw new Error(`Failed to upload game data: ${uploaded.stderr}`);
  }
  return { uploaded: true, summary };
}
