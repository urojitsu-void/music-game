#!/usr/bin/env node

import { runBuild } from './build/run-build.ts';

async function main(args: readonly string[]): Promise<void> {
  const [command, inputPath, ...extra] = args;
  if (command !== 'build' || !inputPath || extra.length > 0) {
    throw new Error('Usage: tsx src/cli.ts build <audio.mp3|video.mp4|video.mov>');
  }
  await runBuild({ inputPath });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[失敗] ${message}`);
  process.exitCode = 1;
});
