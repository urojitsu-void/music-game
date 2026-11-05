import { rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { temporarySiblingPath } from '../platform/temporary-path.ts';
import { validateChart } from './validation.ts';

export * from './validation.ts';

export async function writeChartAtomic(chart: unknown, outputPath: string): Promise<string> {
  const validated = validateChart(chart);
  const absolutePath = resolve(outputPath);
  const temporaryPath = temporarySiblingPath(absolutePath);
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, absolutePath);
  return absolutePath;
}
