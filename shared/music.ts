// Tonarten, Camelot-Rad und Übergangs-Bewertung für harmonisches Mixen.

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };

// Camelot-Nummer je Grundton (Dur = B, Moll = A)
const MAJOR_CAMELOT: Record<string, number> = { B: 1, "F#": 2, "C#": 3, "G#": 4, "D#": 5, "A#": 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 };
const MINOR_CAMELOT: Record<string, number> = { "G#": 1, "D#": 2, "A#": 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, "F#": 11, "C#": 12 };

export interface Camelot {
  num: number; // 1..12
  letter: "A" | "B"; // A = Moll, B = Dur
}

/** Wandelt "Am", "A minor", "F#m", "Bbmaj", "8A", "5m" (Open Key) usw. in Camelot um. */
export function parseKey(input: string | null | undefined): Camelot | null {
  if (!input) return null;
  const s = input.trim().replace("♯", "#").replace("♭", "b");
  const cam = s.match(/^(1[0-2]|[1-9])\s*([ABab])$/);
  if (cam) return { num: Number(cam[1]), letter: cam[2].toUpperCase() as "A" | "B" };
  const open = s.match(/^(1[0-2]|[1-9])\s*([dmDM])$/);
  if (open) {
    // Open Key: 1d = C-Dur = 8B, 1m = A-Moll = 8A
    const num = ((Number(open[1]) + 6) % 12) + 1;
    return { num, letter: open[2].toLowerCase() === "m" ? "A" : "B" };
  }
  const m = s.match(/^([A-Ga-g])([#b]?)\s*(.*)$/);
  if (!m) return null;
  let root = m[1].toUpperCase() + (m[2] ?? "");
  root = FLAT[root] ?? root;
  if (!NOTES.includes(root)) return null;
  const rest = m[3].toLowerCase();
  const minor = /^(m(?!aj)|min|minor|moll)/.test(rest) || rest === "-";
  const num = minor ? MINOR_CAMELOT[root] : MAJOR_CAMELOT[root];
  return { num, letter: minor ? "A" : "B" };
}

export const camelotString = (c: Camelot | null) => (c ? `${c.num}${c.letter}` : "");

export function keyName(c: Camelot | null): string {
  if (!c) return "";
  const table = c.letter === "A" ? MINOR_CAMELOT : MAJOR_CAMELOT;
  const root = Object.keys(table).find((k) => table[k] === c.num) ?? "";
  return c.letter === "A" ? `${root}m` : root;
}

/** 0 = perfekt, 1 = gut (benachbart / Paralleltonart), 2 = Energie-Boost (+2 / ±7), 3+ = Clash */
export function keyDistance(a: Camelot | null, b: Camelot | null): number {
  if (!a || !b) return 1.5; // unbekannt: neutral
  const step = (b.num - a.num + 12) % 12;
  if (a.letter === b.letter) {
    if (step === 0) return 0;
    if (step === 1 || step === 11) return 1;
    if (step === 2 || step === 7) return 2; // Energy Boost
    return 3 + Math.min(step, 12 - step) / 2;
  }
  if (step === 0) return 1; // relativ Dur/Moll
  if ((a.letter === "A" && step === 1) || (a.letter === "B" && step === 11)) return 2; // diagonal
  return 4;
}

/** BPM-Differenz in Prozent, wobei halbe/doppelte Tempi berücksichtigt werden (z.B. 85 ↔ 170). */
export function bpmDelta(a: number | null | undefined, b: number | null | undefined): number {
  if (!a || !b) return 4;
  const candidates = [b, b * 2, b / 2];
  return Math.min(...candidates.map((x) => (Math.abs(x - a) / a) * 100));
}

/** Pitch-Bereich eines Plattenspielers (Technics: ±8 %) in BPM. */
export const pitchRange = (bpm: number, percent = 8) => [Math.round(bpm * (1 - percent / 100)), Math.round(bpm * (1 + percent / 100))];
