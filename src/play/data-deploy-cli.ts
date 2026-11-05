import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { DATA_RELEASE_REPOSITORY, DATA_RELEASE_TAG } from './data-config.ts';
import {
  deployPreparedData,
  prepareDataDeployment,
  type CommandResult,
} from './deploy-data.ts';

async function run(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (stdout) process.stdout.write(stdout);
      resolveResult({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function main(): Promise<void> {
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
  if (unknown.length > 0) throw new TypeError(`Unknown data deploy argument: ${unknown[0]}`);
  const dryRun = process.argv.includes('--dry-run');
  const dataDirectory = resolve(process.cwd(), 'data');
  const release = { repository: DATA_RELEASE_REPOSITORY, tag: DATA_RELEASE_TAG };
  const deployment = await prepareDataDeployment({ dataDirectory, release });
  try {
    const result = await deployPreparedData(deployment, { dryRun, run });
    process.stdout.write(`${result.summary.join('\n')}\n`);
    process.stdout.write(dryRun ? 'dry-run: no files uploaded\n' : 'game data deployed\n');
  } finally {
    await deployment.cleanup();
  }
}

await main();
