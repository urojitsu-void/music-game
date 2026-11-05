import type { Chart } from '../chart/schema.ts';

export type FlickDirection = 'left' | 'right' | 'up' | 'down';
export type GameEventKind = 'tap' | 'flick' | 'hold-start' | 'hold-end';

export interface GameEvent {
  readonly id: string;
  readonly noteIndex: number;
  readonly kind: GameEventKind;
  readonly time: number;
  readonly lane: number;
  readonly direction?: FlickDirection;
}

export function expandChartEvents(chart: Chart): readonly GameEvent[] {
  const events: GameEvent[] = [];

  chart.notes.forEach((note, noteIndex) => {
    if (note.type === 'tap') {
      events.push({
        id: `${noteIndex}:tap`, noteIndex, kind: 'tap', time: note.time, lane: note.lane,
      });
    } else if (note.type === 'flick') {
      events.push({
        id: `${noteIndex}:flick`,
        noteIndex,
        kind: 'flick',
        time: note.time,
        lane: note.lane,
        direction: note.direction,
      });
    } else {
      events.push({
        id: `${noteIndex}:hold-start`,
        noteIndex,
        kind: 'hold-start',
        time: note.time,
        lane: note.lane,
      });
      events.push({
        id: `${noteIndex}:hold-end`,
        noteIndex,
        kind: 'hold-end',
        time: note.time + note.duration,
        lane: note.lane,
      });
    }
  });

  return events.sort((left, right) => left.time - right.time || left.noteIndex - right.noteIndex);
}
