import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const CONFIG_KEYS = ['difficulty', 'seed', 'outDir', 'cover', 'layout'];
const LAYOUT_KEYS = ['gameX', 'gameY', 'gameWidth', 'gameHeight'];
const DEFAULT_LAYOUT = Object.freeze({
  gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68,
});

function validateObject(value, keys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`Unknown ${name} key: ${key}`);
  }
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function validateConfig(value) {
  validateObject(value, CONFIG_KEYS, 'config');
  const config = definedEntries(value);
  if ('difficulty' in config && !['easy', 'normal', 'hard'].includes(config.difficulty)) {
    throw new TypeError('config difficulty must be easy, normal, or hard');
  }
  if ('seed' in config && !Number.isSafeInteger(config.seed)) {
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
    config.layout = definedEntries(config.layout);
    for (const [key, number] of Object.entries(config.layout)) {
      const isSize = key === 'gameWidth' || key === 'gameHeight';
      if (!Number.isFinite(number) || number > 1 || (isSize ? number <= 0 : number < 0)) {
        throw new RangeError(`layout ${key} must be ${isSize ? 'greater than 0' : 'at least 0'} and at most 1`);
      }
    }
  }
  return config;
}

export async function loadConfig({ cwd = process.cwd(), inputPath, cli = {} }) {
  const configPath = join(dirname(resolve(cwd, inputPath)), 'music-game.config.json');
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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
    difficulty: 'normal', seed: 12345, outDir: 'output', cover: null,
    ...fromFile, ...fromCli,
    layout: Object.freeze(layout),
  };
  config.outDir = resolve(cwd, config.outDir);
  if (config.cover !== null) config.cover = resolve(cwd, config.cover);
  return Object.freeze(config);
}
