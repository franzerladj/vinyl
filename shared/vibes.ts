// Kostenlose Vibe- und Energie-Schätzung aus Styles, BPM, Last.fm-Tags und Audio-Analyse.

export type Slot = "warmup" | "build" | "peak" | "closing";

/** Grund-Energie (1..10) und typische Vibe-Tags je Discogs-Style */
const STYLES: Record<string, [number, string[]]> = {
  ambient: [1.5, ["ambient", "floating"]],
  downtempo: [3, ["chill", "laid-back"]],
  "trip hop": [3, ["moody", "chill"]],
  balearic: [3.5, ["balearic", "sunny"]],
  dub: [3.5, ["dubby", "spacey"]],
  jazz: [3, ["jazzy"]],
  "soul-jazz": [4, ["jazzy", "soulful"]],
  soul: [4, ["soulful", "warm"]],
  "jazz-funk": [5, ["jazzy", "funky"]],
  "dub techno": [5, ["dubby", "hypnotic"]],
  "deep house": [5, ["deep", "warm"]],
  "lo-fi house": [5, ["lo-fi", "dusty"]],
  "broken beat": [5.5, ["broken", "jazzy"]],
  leftfield: [5, ["leftfield"]],
  "hip hop": [5, ["boom bap"]],
  "boom bap": [5, ["boom bap"]],
  "synth-pop": [5, ["synthy", "80s"]],
  funk: [6, ["funky"]],
  boogie: [6, ["boogie", "funky"]],
  disco: [6.5, ["disco", "funky"]],
  "nu-disco": [6.5, ["disco", "groovy"]],
  "italo-disco": [6.5, ["italo", "synthy"]],
  "garage house": [6, ["soulful", "vocal"]],
  house: [6, ["housy", "groovy"]],
  "chicago house": [6.5, ["jacking", "raw"]],
  "afro house": [6.5, ["afro", "percussive"]],
  afrobeat: [6, ["afro", "percussive"]],
  latin: [6, ["latin", "percussive"]],
  "tech house": [7, ["groovy", "tech"]],
  "progressive house": [7, ["progressive", "melodic"]],
  "acid house": [7, ["acid", "raw"]],
  electro: [7, ["electro", "robotic"]],
  breakbeat: [7, ["breaks"]],
  breaks: [7, ["breaks"]],
  "uk garage": [7, ["2-step", "bouncy"]],
  "minimal techno": [6.5, ["minimal", "hypnotic"]],
  minimal: [6.5, ["minimal", "hypnotic"]],
  "detroit techno": [7, ["detroit", "soulful"]],
  techno: [8, ["driving", "techno"]],
  acid: [8, ["acid"]],
  trance: [8, ["euphoric", "trancey"]],
  "electro house": [8, ["big room"]],
  ebm: [8, ["dark", "industrial"]],
  industrial: [8, ["dark", "industrial"]],
  dubstep: [8, ["bass", "dark"]],
  "hard techno": [9, ["hard", "driving"]],
  "drum n bass": [9, ["rollers"]],
  jungle: [9, ["jungle", "breaks"]],
  hardcore: [9.5, ["hard"]],
};

/** Last.fm-Tags, die etwas über den Vibe sagen: [Anzeige-Tag, Energie-Verschiebung] */
const TAGS: Record<string, [string, number]> = {
  chill: ["chill", -2],
  chillout: ["chill", -2],
  relaxing: ["chill", -2],
  mellow: ["mellow", -1.5],
  calm: ["calm", -2],
  dreamy: ["dreamy", -1],
  atmospheric: ["atmospheric", -1],
  melancholic: ["melancholisch", -1],
  melancholy: ["melancholisch", -1],
  sad: ["melancholisch", -1],
  romantic: ["romantisch", -1],
  sensual: ["sexy", -0.5],
  sexy: ["sexy", 0],
  warm: ["warm", -0.5],
  deep: ["deep", -0.5],
  hypnotic: ["hypnotic", 0],
  groovy: ["groovy", 0.5],
  funky: ["funky", 0.5],
  soulful: ["soulful", 0],
  jazzy: ["jazzy", -0.5],
  dark: ["dark", 0.5],
  psychedelic: ["psychedelic", 0],
  happy: ["happy", 0.5],
  sunny: ["sunny", 0],
  summer: ["sunny", 0.5],
  uplifting: ["uplifting", 1],
  euphoric: ["euphoric", 1.5],
  energetic: ["energetic", 1.5],
  party: ["party", 1.5],
  dance: ["tanzbar", 0.5],
  danceable: ["tanzbar", 0.5],
  banger: ["banger", 2],
  "peak time": ["peak", 2],
  anthem: ["anthem", 1.5],
  aggressive: ["aggressive", 2],
  hard: ["hard", 1.5],
  raw: ["raw", 0.5],
  minimal: ["minimal", 0],
  acid: ["acid", 0.5],
  vocal: ["vocal", 0],
  instrumental: ["instrumental", 0],
  "warm up": ["warmup", -1.5],
  sunset: ["sunset", -1],
  "late night": ["late night", 0],
  afterhours: ["afterhours", 0],
};

export interface VibeInputs {
  styles: string[];
  bpm?: number | null;
  /** Last.fm-Tags (Kleinbuchstaben) mit Gewicht 0..100 */
  tags?: { name: string; count: number }[];
  /** Energie aus der Audio-Analyse (1..10) */
  audioEnergy?: number | null;
}

export interface VibeResult {
  energy: number;
  moods: string[];
  slot: Slot;
  sources: string[];
}

export const slotFor = (energy: number): Slot => (energy <= 4 ? "warmup" : energy <= 6.5 ? "build" : "peak");

export function estimateVibe(i: VibeInputs): VibeResult {
  const sources: string[] = [];
  const moods = new Map<string, number>();
  let styleEnergy: number | null = null;

  const matched = i.styles.map((s) => STYLES[s.toLowerCase()]).filter(Boolean);
  if (matched.length) {
    styleEnergy = matched.reduce((a, [e]) => a + e, 0) / matched.length;
    matched.forEach(([, m], k) => m.forEach((x) => moods.set(x, (moods.get(x) ?? 0) + 3 - Math.min(k, 2))));
    sources.push("Styles");
  }

  let energy = styleEnergy ?? 5;
  if (i.bpm) {
    // Tempo verschiebt die Energie: 120 BPM neutral, ±8 BPM ≈ ±1 Punkt (gedeckelt)
    const b = i.bpm < 80 ? i.bpm * 2 : i.bpm;
    energy += Math.max(-2, Math.min(2, (b - 120) / 8));
    sources.push("BPM");
  }

  if (i.tags?.length) {
    let shift = 0;
    let weight = 0;
    for (const t of i.tags) {
      const hit = TAGS[t.name];
      if (!hit) continue;
      const w = Math.max(0.1, t.count / 100);
      moods.set(hit[0], (moods.get(hit[0]) ?? 0) + 4 * w);
      shift += hit[1] * w;
      weight += w;
    }
    if (weight > 0) {
      energy += Math.max(-2.5, Math.min(2.5, shift / Math.max(1, weight)));
      sources.push("Last.fm");
    }
  }

  if (i.audioEnergy != null) {
    // Gemessene Energie zählt am meisten
    energy = energy * 0.45 + i.audioEnergy * 0.55;
    sources.push("Audio");
  }

  const e = Math.max(1, Math.min(10, Math.round(energy)));
  const list = [...moods.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m).slice(0, 4);
  return { energy: e, moods: list, slot: slotFor(e), sources };
}
