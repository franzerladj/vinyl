// Tonart-Analyse gegen von Hand bestimmte Tonarten messen.
// Datensatz: GiantSteps Key (604 Tanzmusik-Stücke von Beatport, Tonart von Menschen notiert),
// https://github.com/GiantSteps/giantsteps-key-dataset. Liegt nicht im Repo.
//   npx tsx tools/audio/keyeval.ts <ordner-mit-annotations> <ordner-mit-mp3> [cache-ordner] [anzahl]
// Je Stück werden 30 s ab Sekunde 30 gemessen (so lang sind die Hörproben in der App).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeSamples } from "../../shared/audioAnalysis";

const [ann, audio, cache = join(audio, "../pcm"), limitArg] = process.argv.slice(2);
if (!ann || !audio) throw new Error("Aufruf: keyeval.ts <annotations> <audio> [cache] [anzahl]");
mkdirSync(cache, { recursive: true });
const SR = 22050;
const START = Number(process.env.START ?? 30);
const LEN = Number(process.env.LEN ?? 30);

const NOTES: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
/** „Eb minor“ oder „D#m“ → [Grundton 0..11, Moll] */
function parse(k: string): [number, boolean] | null {
  const m = k.trim().match(/^([A-G][#b]?)\s*(m|minor|major)?$/i);
  if (!m) return null;
  const root = NOTES[m[1][0].toUpperCase() + m[1].slice(1)];
  return root == null ? null : [root, /^m(inor)?$/i.test(m[2] ?? "")];
}
/** Wertung wie beim MIREX-Wettbewerb: richtig 1, Quinte 0,5, Paralleltonart 0,3, gleichnamig 0,2 */
function relation(truth: [number, boolean], got: [number, boolean]): "richtig" | "quinte" | "parallel" | "gleichnamig" | "falsch" {
  const d = (got[0] - truth[0] + 12) % 12;
  if (d === 0 && truth[1] === got[1]) return "richtig";
  if (truth[1] === got[1] && (d === 7 || d === 5)) return "quinte";
  if (!truth[1] && got[1] && d === 9) return "parallel";
  if (truth[1] && !got[1] && d === 3) return "parallel";
  if (d === 0) return "gleichnamig";
  return "falsch";
}
const SCORE = { richtig: 1, quinte: 0.5, parallel: 0.3, gleichnamig: 0.2, falsch: 0 };

function pcm(id: string): Float32Array | null {
  const file = join(cache, `${id}-${START}-${LEN}.f32`);
  if (!existsSync(file)) {
    const src = join(audio, `${id}.mp3`);
    if (!existsSync(src)) return null;
    try {
      const out = execFileSync("ffmpeg", ["-v", "error", "-ss", String(START), "-t", String(LEN), "-i", src, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
      writeFileSync(file, out);
    } catch {
      return null;
    }
  }
  const b = readFileSync(file);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

const ids = readdirSync(join(ann, "key")).map((f) => f.replace(/\.LOFI\.key$/, "")).sort().slice(0, limitArg ? Number(limitArg) : undefined);
const rows: { id: string; genre: string; truth: string; got: string | null; conf: number; rel: keyof typeof SCORE | "nichts" }[] = [];
for (const id of ids) {
  const truthText = readFileSync(join(ann, "key", `${id}.LOFI.key`), "utf8").trim();
  const truth = parse(truthText);
  const samples = pcm(id);
  if (!truth || !samples || samples.length < SR * 10) continue;
  const genre = existsSync(join(ann, "genre", `${id}.LOFI.genre`)) ? readFileSync(join(ann, "genre", `${id}.LOFI.genre`), "utf8").trim() : "";
  const a = analyzeSamples(samples, SR);
  const got = a.key ? parse(a.key) : null;
  rows.push({ id, genre, truth: truthText, got: a.key, conf: a.keyConfidence, rel: got ? relation(truth, got) : "nichts" });
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : "–");
function report(name: string, set: typeof rows) {
  const answered = set.filter((r) => r.rel !== "nichts");
  const count = (k: string) => set.filter((r) => r.rel === k).length;
  const score = answered.reduce((a, r) => a + SCORE[r.rel as keyof typeof SCORE], 0);
  console.log(
    `${name.padEnd(26)} n=${String(set.length).padStart(3)}  richtig ${pct(count("richtig"), set.length).padStart(7)}  gewichtet ${pct(score, set.length).padStart(7)}  ` +
      `Quinte ${count("quinte")}  parallel ${count("parallel")}  gleichnamig ${count("gleichnamig")}  falsch ${count("falsch")}  ohne ${count("nichts")}`,
  );
}
report("alle", rows);
// Was die App übernimmt: nur Ergebnisse ab Sicherheit 0,3
for (const th of [0.3, 0.5, 0.7]) {
  const sure = rows.filter((r) => r.rel !== "nichts" && r.conf >= th);
  console.log(`  ab Sicherheit ${th}: ${sure.length} von ${rows.length} (${pct(sure.length, rows.length)}), davon richtig ${pct(sure.filter((r) => r.rel === "richtig").length, sure.length)}, mixbar ${pct(sure.filter((r) => r.rel !== "falsch").length, sure.length)}`);
}
const HOUSE = /house|techno|minimal|disco/;
report("House, Techno, Disco", rows.filter((r) => HOUSE.test(r.genre)));
report("übrige", rows.filter((r) => !HOUSE.test(r.genre)));
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(rows));
