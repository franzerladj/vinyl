// Trefferquote der Deezer-Suche bei typischer Tanzmusik messen (Titel aus dem GiantSteps-MTG-Datensatz von Beatport).
//   npx tsx tools/audio/dzrate.ts <beatport_metadata.txt> [anzahl]
import { readFileSync } from "node:fs";
import { deezer } from "../../server/audio";

const [file, n = "100"] = process.argv.slice(2);
if (!file) throw new Error("Aufruf: dzrate.ts <beatport_metadata.txt> [anzahl]");
const rows = readFileSync(file, "utf8").split("\n").slice(1).map((l) => l.split("\t")).filter((p) => p.length >= 4 && p[1] && p[2]);
// feste Stichprobe: jede 12. Zeile
const sample = rows.filter((_, i) => i % 12 === 5).slice(0, Number(n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let hit = 0;
const missed: string[] = [];
for (const [, artistRaw, song, mix] of sample) {
  // So wie Discogs es schreibt: mehrere Artists mit „&“, Mix in Klammern
  const artist = artistRaw.split(",").map((x) => x.trim()).join(" & ");
  const title = mix ? `${song} (${mix})` : song;
  const r = await deezer(artist, title, null).catch(() => null);
  if (r?.previewUrl) hit++;
  else missed.push(`${artist} – ${title}`);
  await sleep(700); // Deezer erlaubt 50 Anfragen in 5 Sekunden
}
console.log(`${hit} von ${sample.length} mit Hörprobe (${Math.round((100 * hit) / sample.length)} %)`);
if (process.env.MISSED) console.log(missed.join("\n"));
