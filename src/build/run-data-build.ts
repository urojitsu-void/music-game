import { parse, resolve } from 'node:path';

import { preparePlayable, type PreparePlayableOptions } from './prepare-playable.ts';

interface RunDataBuildDependencies {
  readonly preparePlayable: typeof preparePlayable;
}

export interface RunDataBuildOptions {
  readonly cwd?: string;
  readonly inputPath: string;
  readonly subtitle?: string | null;
  readonly dependencies?: Partial<RunDataBuildDependencies>;
}

export interface DataBuildResult {
  readonly outDir: string;
  readonly backgroundPath: string;
  readonly chartPath: string;
}

export async function runDataBuild(options: RunDataBuildOptions): Promise<DataBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, 'data', parse(options.inputPath).name);
  const dependencies = { preparePlayable, ...options.dependencies };
  const prepareOptions: PreparePlayableOptions = {
    cwd,
    inputPath: options.inputPath,
    subtitle: options.subtitle,
    outDir,
  };
  const prepared = await dependencies.preparePlayable(prepareOptions);
  console.log(`[出力] ${outDir}`);
  return {
    outDir,
    backgroundPath: prepared.backgroundPath,
    chartPath: prepared.chartPath,
  };
}
