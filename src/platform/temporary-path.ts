import { basename, dirname, extname, join } from 'node:path';

export function temporarySiblingPath(outputPath: string, pid = process.pid): string {
  const extension = extname(outputPath);
  const stem = basename(outputPath, extension);
  return join(dirname(outputPath), `${stem}.${pid}.tmp${extension}`);
}
