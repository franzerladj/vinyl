// Für Vinylheads: Zustand nach Goldmine und Angaben zur Pressung aus Discogs.

/** Discogs-Werte der Felder „Media Condition“ und „Sleeve Condition“, mit Kurzform */
export const MEDIA_GRADES = [
  ["Mint (M)", "M"],
  ["Near Mint (NM or M-)", "NM"],
  ["Very Good Plus (VG+)", "VG+"],
  ["Very Good (VG)", "VG"],
  ["Good Plus (G+)", "G+"],
  ["Good (G)", "G"],
  ["Fair (F)", "F"],
  ["Poor (P)", "P"],
] as const;

export const SLEEVE_GRADES = [...MEDIA_GRADES, ["Generic", "Generic"], ["Not Graded", "ohne"], ["No Cover", "keine"]] as const;

/** Kurzbeschreibung zum Antippen, damit man nicht raten muss */
export const GRADE_HINT: Record<string, string> = {
  M: "Neu, nie gespielt",
  NM: "Fast neu, kaum Spuren",
  "VG+": "Leichte Spuren, spielt sauber",
  VG: "Hörbares Knistern in leisen Stellen",
  "G+": "Deutlich abgespielt, läuft durch",
  G: "Stark abgespielt",
  F: "Springt oder rauscht stark",
  P: "Kaum spielbar",
};

/** Die Hülle bewertet man nach Abnutzung, nicht nach Klang */
export const SLEEVE_HINT: Record<string, string> = {
  M: "Neu, noch eingeschweißt",
  NM: "Wie neu, keine Knicke, keine Schrift",
  "VG+": "Leicht abgenutzt, Ecken minimal gestoßen",
  VG: "Leichter Ringabrieb, kleine Knicke oder Nahtriss",
  "G+": "Deutlicher Ringabrieb, Risse an der Naht, Schrift",
  G: "Stark abgenutzt, größere Risse",
  F: "Beschädigt, Wasserschaden oder Teile fehlen",
  P: "Kaum noch zu erkennen",
  Generic: "Neutrale Hülle ohne Druck",
  ohne: "Hülle nicht bewertet",
  keine: "Platte ohne Hülle",
};

export function shortGrade(v?: string | null): string | undefined {
  if (!v) return undefined;
  const hit = SLEEVE_GRADES.find(([long, short]) => long === v || short === v);
  if (hit) return hit[1];
  // Abweichende Schreibweisen: „VG+“, „NM-“, „Near Mint“
  const m = v.match(/(?<![\w+])(M-|NM|VG\+|VG|G\+|G|F|P|M)(?![\w+])/i);
  return m ? (m[1].toUpperCase() === "M-" ? "NM" : m[1].toUpperCase()) : undefined;
}

export const longGrade = (short: string, sleeve = false) => (sleeve ? SLEEVE_GRADES : MEDIA_GRADES).find(([, s]) => s === short)?.[0];

/** Rangfolge zum Sortieren und Filtern: höher = besser */
export function gradeRank(short?: string): number {
  const i = MEDIA_GRADES.findIndex(([, s]) => s === short);
  return i < 0 ? -1 : MEDIA_GRADES.length - i;
}

export interface Pressing {
  matrix: string[];
  barcode?: string;
  /** Wer die Lackfolie geschnitten oder gemastert hat */
  cut: string[];
  pressed: string[];
  other: { role: string; name: string }[];
}

const ROLE_DE: Record<string, string> = {
  "Lacquer Cut At": "Geschnitten bei",
  "Lacquer Cut By": "Geschnitten bei",
  "Mastered At": "Gemastert bei",
  "Mastered By": "Gemastert bei",
  "Pressed By": "Gepresst bei",
  "Manufactured By": "Hergestellt von",
  "Made By": "Hergestellt von",
  "Distributed By": "Vertrieb",
  "Record Company": "Plattenfirma",
  "Recorded At": "Aufgenommen in",
  "Mixed At": "Gemischt in",
};
export const roleDe = (r: string) => ROLE_DE[r] ?? r;

export function pressingInfo(identifiers: { type: string; value: string; description?: string }[] = [], companies: { name: string; entity_type_name: string }[] = []): Pressing {
  const clean = (n: string) => n.replace(/\s\(\d+\)$/, "");
  const matrix = identifiers
    .filter((i) => /matrix|runout/i.test(i.type))
    .map((i) => (i.description ? `${i.value}  (${i.description})` : i.value))
    .filter((v, i, a) => v.trim() && a.indexOf(v) === i);
  const barcode = identifiers.find((i) => i.type === "Barcode")?.value;
  const cut = [...new Set(companies.filter((c) => /Lacquer Cut|Mastered/.test(c.entity_type_name)).map((c) => clean(c.name)))];
  const pressed = [...new Set(companies.filter((c) => /Pressed By|Manufactured By|Made By/.test(c.entity_type_name)).map((c) => clean(c.name)))];
  const other = companies
    .filter((c) => !/Lacquer Cut|Mastered|Pressed By|Manufactured By|Made By/.test(c.entity_type_name))
    .map((c) => ({ role: roleDe(c.entity_type_name), name: clean(c.name) }))
    .slice(0, 6);
  return { matrix, barcode, cut, pressed, other };
}
