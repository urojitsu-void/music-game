import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPagesApp } from './build-pages.ts';
import { startPlayServer } from './server.ts';

export interface PlayServerCliOptions {
  readonly host: string;
  readonly port: number;
}

export function parsePlayServerArgs(args: readonly string[]): PlayServerCliOptions {
  let host = '127.0.0.1';
  let port = 4173;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new TypeError('--host requires a value');
      host = value;
      index += 1;
    } else if (argument === '--port') {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new RangeError('--port must be an integer from 1 to 65535');
      }
      port = value;
      index += 1;
    } else {
      throw new TypeError(`Unknown play server argument: ${argument}`);
    }
  }
  return { host, port };
}

async function main(): Promise<void> {
  const options = parsePlayServerArgs(process.argv.slice(2));
  const root = resolve(process.cwd(), 'dist/play');
  await buildPagesApp({
    outputDirectory: root,
    playlistUrl: process.env.MUSIC_GAME_PLAYLIST_URL,
  });
  const server = await startPlayServer({ ...options, root });
  process.stdout.write(`Music Game: ${server.url}\n`);
  if (options.host === '0.0.0.0') {
    process.stdout.write('同一Wi-Fi内から、このMacのIPアドレスと上記ポートで接続できます。\n');
  }
  const stop = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
