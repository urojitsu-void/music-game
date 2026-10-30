import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Layout {
  readonly gameX: number;
  readonly gameY: number;
  readonly gameWidth: number;
  readonly gameHeight: number;
}

export interface ResolvedConfig {
  readonly difficulty: Difficulty;
  readonly seed: number;
  readonly outDir: string;
  readonly cover: string | null;
  readonly layout: Readonly<Layout>;
}

export interface ConfigOverrides {
  readonly difficulty?: unknown;
  readonly seed?: unknown;
  readonly outDir?: unknown;
  readonly cover?: unknown;
  readonly layout?: unknown;
}

type ValidatedConfig = Partial<Omit<ResolvedConfig, 'layout'>> & {
  layout?: Partial<Layout>;
};

const CONFIG_KEYS = ['difficulty', 'seed', 'outDir', 'cover', 'layout'];
const LAYOUT_KEYS = ['gameX', 'gameY', 'gameWidth', 'gameHeight'];
const DEFAULT_LAYOUT = Object.freeze({
  gameX: 0.5, gameY: 0.68, gameWidth: 0.58, gameHeight: 0.55,
});

function validateObject(
  value: unknown, keys: readonly string[], name: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`Unknown ${name} key: ${key}`);
  }
}

function definedEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function validateConfig(value: unknown): ValidatedConfig {
  validateObject(value, CONFIG_KEYS, 'config');
  const config = definedEntries(value);
  if ('difficulty' in config
    && config.difficulty !== 'easy' && config.difficulty !== 'normal' && config.difficulty !== 'hard') {
    throw new TypeError('config difficulty must be easy, normal, or hard');
  }
  if ('seed' in config && (typeof config.seed !== 'number' || !Number.isSafeInteger(config.seed))) {
    throw new TypeError('config seed must be a safe integer');
  }
  if ('outDir' in config && typeof config.outDir !== 'string') {
    throw new TypeError('config outDir must be a string');
  }
  if ('cover' in config && config.cover !== null && typeof config.cover !== 'string') {
    throw new TypeError('config cover must be a string or null');
  }
  if ('layout' in config) {
    validateObject(config.layout, LAYOUT_KEYS, 'layout');
    const layout = definedEntries(config.layout);
    config.layout = layout;
    for (const [key, number] of Object.entries(layout)) {
      const isSize = key === 'gameWidth' || key === 'gameHeight';
      if (typeof number !== 'number' || !Number.isFinite(number)
        || number > 1 || (isSize ? number <= 0 : number < 0)) {
        throw new RangeError(`layout ${key} must be ${isSize ? 'greater than 0' : 'at least 0'} and at most 1`);
      }
    }
  }
  // Every permitted property has been checked above; undefined entries were removed.
  return config as ValidatedConfig;
}

export async function loadConfig({ cwd = process.cwd(), inputPath, cli = {} }: {
  cwd?: string;
  inputPath: string;
  cli?: ConfigOverrides;
}): Promise<Readonly<ResolvedConfig>> {
  const configPath = join(dirname(resolve(cwd, inputPath)), 'music-game.config.json');
  let fileConfig: unknown = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
  const fromFile = validateConfig(fileConfig);
  const fromCli = validateConfig(cli);
  const layout = { ...DEFAULT_LAYOUT, ...fromFile.layout, ...fromCli.layout };
  if (layout.gameX - layout.gameWidth / 2 < 0
    || layout.gameX + layout.gameWidth / 2 > 1
    || layout.gameY - layout.gameHeight < 0
    || layout.gameY > 1) {
    throw new RangeError('layout game area must fit within the frame');
  }
  const config = {
    difficulty: 'normal' as Difficulty, seed: 12345, outDir: 'output', cover: null,
    ...fromFile, ...fromCli,
    layout: Object.freeze(layout),
  };
  config.outDir = resolve(cwd, config.outDir);
  if (config.cover !== null) config.cover = resolve(cwd, config.cover);
  return Object.freeze(config);
}
