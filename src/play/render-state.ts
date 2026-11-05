import type { Chart } from '../chart/schema.ts';
import type { FrameNote, FrameState, HitState } from '../render/canvas-renderer.ts';
import type { GameSnapshot } from './game-engine.ts';

export function derivePlayFrameState(
  chart: Chart,
  snapshot: GameSnapshot,
  timeSeconds: number,
  options: { readonly travelSec?: number; readonly hitEffectSec?: number } = {},
): FrameState {
  const travelSec = options.travelSec ?? 2;
  const hitEffectSec = options.hitEffectSec ?? 0.22;
  const unresolved = new Set(snapshot.unresolvedEventIds);
  const notes: FrameNote[] = [];

  chart.notes.forEach((note, noteIndex) => {
    const startKind = note.type === 'hold' ? 'hold-start' : note.type;
    const startUnresolved = unresolved.has(`${noteIndex}:${startKind}`);
    const endUnresolved = note.type === 'hold' && unresolved.has(`${noteIndex}:hold-end`);
    if (!startUnresolved && !endUnresolved) return;
    const appearance = note.time - travelSec;
    if (timeSeconds < appearance) return;
    const progress = Math.min(1, (timeSeconds - appearance) / travelSec);
    if (note.type === 'hold') {
      const endTime = note.time + note.duration;
      notes.push({
        ...note,
        progress,
        endProgress: (timeSeconds - (endTime - travelSec)) / travelSec,
      });
    } else {
      notes.push({ ...note, progress });
    }
  });

  const hits: HitState[] = [];
  for (const result of snapshot.judgments) {
    const elapsed = timeSeconds - result.time;
    if (elapsed < 0 || elapsed > hitEffectSec) continue;
    const noteIndex = Number.parseInt(result.eventId.split(':', 1)[0]!, 10);
    const note = chart.notes[noteIndex];
    if (!note) continue;
    hits.push({
      ...note,
      progress: elapsed / hitEffectSec,
      judgment: result.judgment,
    });
  }

  const hitPulse = hits.reduce((pulse, hit) => Math.max(pulse, 1 - hit.progress), 0);
  let fullComboProgress: number | null = null;
  const lastJudgment = snapshot.judgments.at(-1);
  if (snapshot.completed && snapshot.fullCombo && lastJudgment) {
    const elapsed = timeSeconds - lastJudgment.time - hitEffectSec;
    if (elapsed >= 0 && elapsed <= 2.5) fullComboProgress = elapsed / 2.5;
  }

  return {
    notes,
    hits,
    combo: snapshot.combo,
    gauge: snapshot.gauge,
    hitPulse,
    fullComboProgress,
    score: snapshot.score,
  };
}
