import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';

import { temporarySiblingPath } from '../platform/temporary-path.ts';

export type StageName = 'background' | 'chart' | 'overlay' | 'final';
export type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface StageEntry {
  readonly key: string;
  readonly artifactHash: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly completedAt: string;
}

export interface BuildManifest {
  readonly formatVersion: 1;
  readonly resolvedConfig: Readonly<Record<string, JsonValue>>;
  readonly stages: Partial<Record<StageName, StageEntry>>;
}

const DEPENDENTS: Readonly<Record<StageName, readonly StageName[]>> = {
  background: ['final'],
  chart: ['overlay', 'final'],
  overlay: ['final'],
  final: [],
};

const STAGES = new Set<StageName>(['background', 'chart', 'overlay', 'final']);

function stableSerialize(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot hash a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Cannot hash non-JSON value of type ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError('Cannot hash a cyclic value');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(object[key], seen)}`
    ));
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function parseStageEntry(value: unknown): StageEntry | null {
  if (!isRecord(value)
    || typeof value.key !== 'string'
    || typeof value.artifactHash !== 'string'
    || typeof value.completedAt !== 'string') return null;
  if (value.metadata !== undefined && (!isRecord(value.metadata) || !isJsonValue(value.metadata))) {
    return null;
  }
  return {
    key: value.key,
    artifactHash: value.artifactHash,
    ...(value.metadata === undefined
      ? {} : { metadata: value.metadata as Record<string, JsonValue> }),
    completedAt: value.completedAt,
  };
}

function parseManifest(value: unknown): BuildManifest | null {
  if (!isRecord(value)
    || value.formatVersion !== 1
    || !isRecord(value.resolvedConfig)
    || !isJsonValue(value.resolvedConfig)
    || !isRecord(value.stages)) return null;

  const stages: Partial<Record<StageName, StageEntry>> = {};
  for (const [name, rawEntry] of Object.entries(value.stages)) {
    if (!STAGES.has(name as StageName)) return null;
    const entry = parseStageEntry(rawEntry);
    if (!entry) return null;
    stages[name as StageName] = entry;
  }
  return { formatVersion: 1, resolvedConfig: value.resolvedConfig, stages };
}

export async function readManifest(path: string): Promise<BuildManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return parseManifest(parsed);
  } catch {
    return null;
  }
}

export interface StageHitOptions {
  readonly manifest: BuildManifest | null;
  readonly stage: StageName;
  readonly key: string;
  readonly artifactPath: string;
  readonly requiredMetadata?: readonly string[];
}

export async function isStageHit(options: StageHitOptions): Promise<boolean> {
  const {
    manifest, stage, key, artifactPath, requiredMetadata = [],
  } = options;
  const entry = manifest?.stages[stage];
  if (!entry || entry.key !== key) return false;
  if (requiredMetadata.some((name) => entry.metadata?.[name] === undefined)) return false;
  try {
    return await hashFile(artifactPath) === entry.artifactHash;
  } catch {
    return false;
  }
}

export function invalidateDependents(
  manifest: BuildManifest, stage: StageName,
): BuildManifest {
  const invalid = new Set<StageName>();
  const visit = (name: StageName) => {
    for (const dependent of DEPENDENTS[name]) {
      if (invalid.has(dependent)) continue;
      invalid.add(dependent);
      visit(dependent);
    }
  };
  visit(stage);

  const stages = Object.fromEntries(
    Object.entries(manifest.stages).filter(([name]) => !invalid.has(name as StageName)),
  ) as Partial<Record<StageName, StageEntry>>;
  return { ...manifest, stages };
}

export interface RecordStageOptions {
  readonly manifestPath: string;
  readonly resolvedConfig: Readonly<Record<string, JsonValue>>;
  readonly stage: StageName;
  readonly key: string;
  readonly artifactPath: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly now?: () => Date;
}

export async function recordStage(options: RecordStageOptions): Promise<BuildManifest> {
  const {
    manifestPath, resolvedConfig, stage, key, artifactPath, metadata,
    now = () => new Date(),
  } = options;
  if (!isJsonValue(resolvedConfig) || (metadata !== undefined && !isJsonValue(metadata))) {
    throw new TypeError('Manifest values must be JSON-serializable');
  }
  const existing = await readManifest(manifestPath);
  const base: BuildManifest = existing ?? { formatVersion: 1, resolvedConfig, stages: {} };
  const pruned = invalidateDependents(base, stage);
  const entry: StageEntry = {
    key,
    artifactHash: await hashFile(artifactPath),
    ...(metadata === undefined ? {} : { metadata }),
    completedAt: now().toISOString(),
  };
  const manifest: BuildManifest = {
    formatVersion: 1,
    resolvedConfig,
    stages: { ...pruned.stages, [stage]: entry },
  };
  const temporaryPath = temporarySiblingPath(manifestPath);
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, manifestPath);
  return manifest;
}
