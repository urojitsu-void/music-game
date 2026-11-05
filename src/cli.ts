#!/usr/bin/env node

import { runBuild } from './build/run-build.ts';
import { parseBuildArgs, parseDataBuildArgs } from './build/cli-options.ts';
import { runDataBuild } from './build/run-data-build.ts';
import { processSupervisor } from './platform/process.ts';
import { installShutdownHandlers } from './platform/signals.ts';

async function main(args: readonly string[]): Promise<void> {
  if (args[0] === 'data-build') {
    await runDataBuild(parseDataBuildArgs(args));
    return;
  }
  const options = parseBuildArgs(args);
  await runBuild(options);
}

const uninstallShutdownHandlers = installShutdownHandlers(processSupervisor);

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[失敗] ${message}`);
  process.exitCode ??= 1;
}).finally(uninstallShutdownHandlers);
