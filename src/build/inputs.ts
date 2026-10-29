import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, parse, resolve } from 'node:path';

export type ResolvedInputs = Readonly<
  | { mode: 'mp3'; audioPath: string; lrcPath: string; coverPath: string }
  | { mode: 'video'; videoPath: string }
>;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov']);

async function requireFile(path: string, label: string): Promise<void> {
  if (!(await stat(path)).isFile()) throw new Error(`${label} must be a file: ${path}`);
}

export async function resolveInputs({ inputPath, cover = null }: {
  inputPath: string;
  cover?: string | null;
}): Promise<ResolvedInputs> {
  const absoluteInput = resolve(inputPath);
  const extension = extname(absoluteInput).toLowerCase();
  if (extension !== '.mp3' && !VIDEO_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported input extension: ${extension || '(none)'}`);
  }
  await requireFile(absoluteInput, 'Input');
  if (VIDEO_EXTENSIONS.has(extension)) {
    return Object.freeze({ mode: 'video', videoPath: absoluteInput });
  }

  const directory = dirname(absoluteInput);
  const basename = parse(absoluteInput).name;
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && parse(entry.name).name === basename);
  const lyrics = entries.filter((entry) => extname(entry.name).toLowerCase() === '.lrc');
  if (lyrics.length !== 1) throw new Error('MP3 requires exactly one matching LRC file');

  let coverPath: string;
  if (cover !== null) {
    coverPath = resolve(cover);
    if (!IMAGE_EXTENSIONS.has(extname(coverPath).toLowerCase())) {
      throw new Error('Cover must be a PNG, JPG, or JPEG image');
    }
    await requireFile(coverPath, 'Cover');
  } else {
    const images = entries.filter((entry) => IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()));
    if (images.length === 0) throw new Error('MP3 requires a matching cover image');
    if (images.length > 1) throw new Error('Multiple cover images found; specify --cover');
    coverPath = join(directory, images[0].name);
  }
  return Object.freeze({
    mode: 'mp3', audioPath: absoluteInput,
    lrcPath: join(directory, lyrics[0].name), coverPath,
  });
}
