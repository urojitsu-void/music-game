export interface BuildCliOptions {
  readonly inputPath: string;
  readonly subtitle: string | null | undefined;
}

const USAGE = 'Usage: tsx src/cli.ts build <audio.mp3|video.mp4|video.mov> [--subtitle <lyrics.lrc|lyrics.srt>|--no-subtitle]';

const DATA_BUILD_USAGE = 'Usage: tsx src/cli.ts data-build <audio.mp3|video.mp4|video.mov> [--subtitle <lyrics.lrc|lyrics.srt>|--no-subtitle]';

function parseArgs(
  args: readonly string[], expectedCommand: string, usage: string,
): BuildCliOptions {
  const [command, inputPath, ...extra] = args;
  if (command !== expectedCommand || !inputPath) throw new Error(usage);
  if (extra.length === 0) return Object.freeze({ inputPath, subtitle: undefined });
  if (extra.length === 1 && extra[0] === '--no-subtitle') {
    return Object.freeze({ inputPath, subtitle: null });
  }
  if (extra.length === 2 && extra[0] === '--subtitle'
    && extra[1] && !extra[1].startsWith('--')) {
    return Object.freeze({ inputPath, subtitle: extra[1] });
  }
  throw new Error(usage);
}

export function parseBuildArgs(args: readonly string[]): BuildCliOptions {
  return parseArgs(args, 'build', USAGE);
}

export function parseDataBuildArgs(args: readonly string[]): BuildCliOptions {
  return parseArgs(args, 'data-build', DATA_BUILD_USAGE);
}
