import { rename, writeFile } from 'node:fs/promises';

export interface StageErrorLogOptions {
  readonly logPath: string;
  readonly stage: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly code: number | string | null;
  readonly stderr: string;
}

export async function writeStageErrorLog(options: StageErrorLogOptions): Promise<void> {
  const temporaryPath = `${options.logPath}.tmp`;
  const content = `${JSON.stringify({
    stage: options.stage,
    command: options.command,
    arguments: options.args,
    code: options.code,
    stderr: options.stderr,
  }, null, 2)}\n`;
  await writeFile(temporaryPath, content, 'utf8');
  await rename(temporaryPath, options.logPath);
}
