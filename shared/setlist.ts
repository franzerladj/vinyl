// Setlist-Generator: ordnet Tracks nach Energie-Kurve, BPM-Verlauf und harmonischen Übergängen.
import { bpmDelta, keyDistance, parseKey } from "./music";

export interface SetTrack {
  id: string; // eindeutig: releaseId:position
  bpm: number | null;
  key: string | null;
  energy: number | null; // 1..10
  moods?: string[];
}

export type Curve = "warmup" | "peak" | "journey" | "flat" | "closing";

export interface SetlistOptions {
  length: number;
  curve: Curve;
  startBpm?: number;
  endBpm?: number;
  maxBpmJumpPercent?: number; // Standard 6 %
  keyWeight?: number; // 0..2, Standard 1
  mustStartWith?: string;
}

/** Ziel-Energie (1..10) für Position t ∈ [0,1] */
export function targetEnergy(curve: Curve, t: number): number {
  switch (curve) {
    case "warmup":
      return 3 + 4 * t;
    case "peak":
      return 7 + 2.5 * Math.sin(Math.PI * t);
    case "closing":
      return 8 - 5 * t;
    case "flat":
      return 6;
    case "journey":
    default:
      // langsamer Aufbau, Peak bei ~75 %, kurzes Runterkommen
      return t < 0.75 ? 3.5 + 6 * (t / 0.75) : 9.5 - 10 * (t - 0.75);
  }
}

export function transitionCost(a: SetTrack, b: SetTrack, opts: SetlistOptions, t: number, targetBpm: number | null): number {
  const maxJump = opts.maxBpmJumpPercent ?? 6;
  const kw = opts.keyWeight ?? 1;
  const d = bpmDelta(a.bpm, b.bpm);
  let cost = d <= maxJump ? d * 0.6 : 6 + (d - maxJump) * 2;
  cost += keyDistance(parseKey(a.key), parseKey(b.key)) * 1.5 * kw;
  const e = b.energy ?? 5;
  cost += Math.abs(e - targetEnergy(opts.curve, t)) * 1.2;
  if (targetBpm && b.bpm) cost += bpmDelta(targetBpm, b.bpm) * 0.3;
  return cost;
}

/**
 * Greedy-Aufbau mit mehreren Startpunkten, danach 2-opt-Verbesserung.
 * Liefert IDs in Spielreihenfolge.
 */
export function buildSetlist(tracks: SetTrack[], opts: SetlistOptions): string[] {
  const n = Math.min(opts.length, tracks.length);
  if (n === 0) return [];
  const bpmAt = (t: number) =>
    opts.startBpm && opts.endBpm ? opts.startBpm + (opts.endBpm - opts.startBpm) * t : opts.startBpm ?? null;

  const evaluate = (seq: SetTrack[]) => {
    let c = 0;
    for (let i = 1; i < seq.length; i++) c += transitionCost(seq[i - 1], seq[i], opts, i / Math.max(1, n - 1), bpmAt(i / Math.max(1, n - 1)));
    const first = seq[0];
    c += Math.abs((first.energy ?? 5) - targetEnergy(opts.curve, 0)) * 1.2;
    if (bpmAt(0) && first.bpm) c += bpmDelta(bpmAt(0), first.bpm) * 0.3;
    return c;
  };

  const startCandidates = opts.mustStartWith
    ? tracks.filter((t) => t.id === opts.mustStartWith)
    : [...tracks]
        .sort((a, b) => {
          const ta = Math.abs((a.energy ?? 5) - targetEnergy(opts.curve, 0)) + (bpmAt(0) ? bpmDelta(bpmAt(0), a.bpm) * 0.3 : 0);
          const tb = Math.abs((b.energy ?? 5) - targetEnergy(opts.curve, 0)) + (bpmAt(0) ? bpmDelta(bpmAt(0), b.bpm) * 0.3 : 0);
          return ta - tb;
        })
        .slice(0, 8);

  let best: SetTrack[] = [];
  let bestCost = Infinity;
  for (const start of startCandidates) {
    const seq = [start];
    const used = new Set([start.id]);
    while (seq.length < n) {
      const t = seq.length / Math.max(1, n - 1);
      let pick: SetTrack | null = null;
      let pc = Infinity;
      for (const cand of tracks) {
        if (used.has(cand.id)) continue;
        const c = transitionCost(seq[seq.length - 1], cand, opts, t, bpmAt(t));
        if (c < pc) {
          pc = c;
          pick = cand;
        }
      }
      if (!pick) break;
      seq.push(pick);
      used.add(pick.id);
    }
    const cost = evaluate(seq);
    if (cost < bestCost) {
      bestCost = cost;
      best = seq;
    }
  }

  // 2-opt: Teilstücke umdrehen, solange es besser wird
  let improved = true;
  let rounds = 0;
  while (improved && rounds++ < 20) {
    improved = false;
    for (let i = opts.mustStartWith ? 1 : 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const c = evaluate(cand);
        if (c + 1e-9 < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best.map((t) => t.id);
}
