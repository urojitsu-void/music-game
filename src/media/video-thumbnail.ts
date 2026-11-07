import { runProcess } from '../platform/process.ts';

export async function createVideoThumbnail(
  backgroundPath: string,
  outputPath: string,
  ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg',
): Promise<void> {
  await runProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', '1', '-i', backgroundPath,
    '-frames:v', '1',
    '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease',
    '-q:v', '2',
    outputPath,
  ]);
}
