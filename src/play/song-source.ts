import type { Chart } from '../chart/schema.ts';

export interface PlayableSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string | null;
  readonly thumbnailUrl: string | null;
  readonly backgroundVideoUrl: string;
  readonly chart: Chart;
  dispose(): void;
}
