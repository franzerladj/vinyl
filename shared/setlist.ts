// Setlist-Generator: ordnet Tracks nach Energie-Kurve, BPM-Verlauf und harmonischen Übergängen.
import { bpmDelta, keyDistance, parseKey } from "./music";

export interface SetTrack {
  id: string; // eindeutig: releaseId:position
  bpm: number | null;
  key: string | null;
  energy: number | null; // 1..10
  moods?: string[];
  /** Platte, von der der Track stammt (meist gibt es jede Platte nur einmal) */
  group?: string;
  /** 0..1: Bewertung und Datenlage (gemessenes Tempo, bekannte Tonart). Bessere Tracks werden bevorzugt. */
  quality?: number;
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
  /** Höchstens so viele Tracks pro Platte (Standard 1). Reichen die Platten nicht, bis 3 mit Abzug. */
  maxPerRecord?: number;
  /** Gewicht von Bewertung und Datenlage, 0..2, Standard 1 */
  qualityWeight?: number;
}

/** Abzug für den zweiten und dritten Track derselben Platte */
const REPEAT_COST = 12;
/** Dieselbe Platte direkt hintereinander geht praktisch nicht (eine Platte, ein Plattenteller) */
const ADJACENT_COST = 80;

/** Wie viele Tracks pro Platte sind nötig, damit das Set voll wird? Erst gewünschtes Limit, im Notfall bis 3. */
export function effectiveCap(tracks: SetTrack[], length: number, wanted = 1): number {
  const groups = new Set(tracks.map((t) => t.group ?? t.id)).size;
  let cap = Math.max(1, wanted);
  while (cap < 3 && groups * cap < length) cap++;
  return cap;
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
  cost += (1 - (b.quality ?? 0.5)) * 3 * (opts.qualityWeight ?? 1);
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

  const wantedCap = opts.maxPerRecord ?? 1;
  const cap = effectiveCap(tracks, n, wantedCap);
  const g = (t: SetTrack) => t.group ?? t.id;

  const evaluate = (seq: SetTrack[]) => {
    let c = 0;
    for (let i = 1; i < seq.length; i++) {
      c += transitionCost(seq[i - 1], seq[i], opts, i / Math.max(1, n - 1), bpmAt(i / Math.max(1, n - 1)));
      if (g(seq[i]) === g(seq[i - 1])) c += ADJACENT_COST;
    }
    const first = seq[0];
    c += Math.abs((first.energy ?? 5) - targetEnergy(opts.curve, 0)) * 1.2;
    if (bpmAt(0) && first.bpm) c += bpmDelta(bpmAt(0), first.bpm) * 0.3;
    c += (1 - (first.quality ?? 0.5)) * 3 * (opts.qualityWeight ?? 1);
    // Mehrere Tracks einer Platte: über das gewünschte Limit hinaus deutlich teurer
    const count = new Map<string, number>();
    for (const t of seq) count.set(g(t), (count.get(g(t)) ?? 0) + 1);
    for (const k of count.values()) if (k > wantedCap) c += (k - wantedCap) * REPEAT_COST * 2;
    else if (k > 1) c += (k - 1) * REPEAT_COST * 0.5;
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
    const perGroup = new Map<string, number>([[g(start), 1]]);
    while (seq.length < n) {
      const t = seq.length / Math.max(1, n - 1);
      let pick: SetTrack | null = null;
      let pc = Infinity;
      const prev = seq[seq.length - 1];
      for (const cand of tracks) {
        if (used.has(cand.id)) continue;
        const k = perGroup.get(g(cand)) ?? 0;
        if (k >= cap || g(cand) === g(prev)) continue;
        const c = transitionCost(prev, cand, opts, t, bpmAt(t)) + k * (k >= wantedCap ? REPEAT_COST * 2 : REPEAT_COST * 0.5);
        if (c < pc) {
          pc = c;
          pick = cand;
        }
      }
      if (!pick) break;
      seq.push(pick);
      used.add(pick.id);
      perGroup.set(g(pick), (perGroup.get(g(pick)) ?? 0) + 1);
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
  // Tauschen: jeden Platz gegen ungenutzte Tracks probieren (anderer Track derselben Platte oder andere Platte)
  const pool = tracks.length > 600 ? tracks.slice(0, 600) : tracks;
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (let i = opts.mustStartWith ? 1 : 0; i < best.length; i++) {
      const inSet = new Set(best.map((t) => t.id));
      for (const cand of pool) {
        if (inSet.has(cand.id)) continue;
        const k = best.filter((t, j) => j !== i && g(t) === g(cand)).length;
        if (k >= cap) continue;
        const trial = [...best.slice(0, i), cand, ...best.slice(i + 1)];
        const c = evaluate(trial);
        if (c + 1e-9 < bestCost) {
          inSet.delete(best[i].id);
          inSet.add(cand.id);
          best = trial;
          bestCost = c;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return best.map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Kuratieren statt generieren: Vorschläge mit Begründung für den nächsten Track
// ---------------------------------------------------------------------------
export interface Suggestion {
  id: string;
  score: number;
  reasons: { text: string; tone: "ok" | "warn" | "bad" | "info" }[];
}

/**
 * Welche Tracks passen nach `prev`? Bewertet Tempo, Tonart, Energie (Richtung der gewünschten Kurve),
 * Bewertung und Datenlage. Platten, die schon im Set sind, fallen raus (eine Platte, ein Plattenteller).
 */
export function suggestNext(prev: SetTrack | null, candidates: SetTrack[], opts: { usedGroups?: Set<string>; energyGoal?: number | null; limit?: number } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of candidates) {
    if (opts.usedGroups?.has(c.group ?? c.id)) continue;
    const reasons: Suggestion["reasons"] = [];
    let cost = 0;
    if (prev) {
      if (prev.bpm && c.bpm) {
        const d = bpmDelta(prev.bpm, c.bpm);
        const diff = Math.round(c.bpm - prev.bpm);
        cost += d <= 6 ? d * 0.6 : 6 + (d - 6) * 2;
        reasons.push({ text: Math.abs(diff) < 1 ? "gleiches Tempo" : `${diff > 0 ? "+" : ""}${diff} BPM`, tone: d <= 3 ? "ok" : d <= 6 ? "warn" : "bad" });
      } else {
        cost += 3;
        reasons.push({ text: "Tempo unbekannt", tone: "info" });
      }
      const kd = keyDistance(parseKey(prev.key), parseKey(c.key));
      if (prev.key && c.key) {
        cost += kd * 1.5;
        if (kd <= 1) reasons.push({ text: `${prev.key} → ${c.key} harmonisch`, tone: "ok" });
        else if (kd <= 2) reasons.push({ text: "Energy-Boost", tone: "warn" });
        else reasons.push({ text: "Key-Clash", tone: "bad" });
      } else cost += 1.5;
    }
    if (opts.energyGoal != null && c.energy != null) {
      const de = c.energy - (prev?.energy ?? opts.energyGoal);
      cost += Math.abs(c.energy - opts.energyGoal) * 1.2;
      if (Math.abs(de) >= 1) reasons.push({ text: `Energie ${de > 0 ? "+" : ""}${Math.round(de)}`, tone: Math.abs(c.energy - opts.energyGoal) <= 1.5 ? "ok" : "warn" });
    }
    cost += (1 - (c.quality ?? 0.5)) * 3;
    out.push({ id: c.id, score: -cost, reasons });
  }
  // Pro Platte nur den besten Track vorschlagen
  const best = new Map<string, Suggestion>();
  const groupOf = new Map(candidates.map((c) => [c.id, c.group ?? c.id]));
  for (const s of out.sort((a, b) => b.score - a.score)) if (!best.has(groupOf.get(s.id)!)) best.set(groupOf.get(s.id)!, s);
  return [...best.values()].slice(0, opts.limit ?? 6);
}

/** Kennzahlen eines Sets: harmonische Übergänge, Tempo-Spanne, größter Sprung */
export function setStats(seq: SetTrack[]) {
  let harmonic = 0;
  let known = 0;
  let maxJump = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1].key && seq[i].key) {
      known++;
      if (keyDistance(parseKey(seq[i - 1].key), parseKey(seq[i].key)) <= 1) harmonic++;
    }
    if (seq[i - 1].bpm && seq[i].bpm) maxJump = Math.max(maxJump, bpmDelta(seq[i - 1].bpm, seq[i].bpm));
  }
  const bpms = seq.map((t) => t.bpm).filter((b): b is number => Boolean(b));
  return { harmonic, known, maxJump, minBpm: bpms.length ? Math.min(...bpms) : null, maxBpm: bpms.length ? Math.max(...bpms) : null };
}
