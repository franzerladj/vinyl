// Lebensdauer von Nadeln laut Hersteller. Nur Angaben, die die Hersteller selbst veröffentlichen
// (Stand November 2026), nichts Geschätztes. Unbekannte Nadeln bekommen keinen Wert.
//
// Quellen:
// - Ortofon: „up to 1000 hours“ bei guter Pflege (ortofon.com, „When to replace the stylus of your phono cartridge?“)
// - Audio-Technica: konisch 500, elliptisch 300, MicroLine 1000, Shibata/Special Line Contact 800 Stunden (Stylus Replacement Guide)
// - Shure: 500 bis 1000 Stunden unter normalen Bedingungen (Shure FAQ „How long will a phonograph stylus last?“)

export interface StylusLife {
  hours: number;
  /** Kurzer Satz für die Oberfläche */
  note: string;
}

export function stylusLife(name: string | undefined | null): StylusLife | null {
  const n = (name ?? "").toLowerCase();
  if (!n.trim()) return null;
  if (/ortofon|concorde|nightclub|\bom\s?pro|\b2m\b/.test(n)) return { hours: 1000, note: "Ortofon nennt bis zu 1000 Stunden bei guter Pflege." };
  if (/audio[- ]?technica|\bat[- ]?(xp|vm|95|91|33|oc|art)|\bvm\s?95|\bvm\d{3}/.test(n)) {
    if (/micro\s?line|\bml\b|95ml|vm\d*ml/.test(n)) return { hours: 1000, note: "Audio-Technica nennt 1000 Stunden für MicroLine-Nadeln." };
    if (/shibata|\bsh\b|95sh|vm\d*sh|line contact|\bslc\b/.test(n)) return { hours: 800, note: "Audio-Technica nennt 800 Stunden für Shibata- und Line-Contact-Nadeln." };
    if (/conical|konisch|sph|xp3|95c\b|at91\b|at-91\b|vm\d*cb/.test(n)) return { hours: 500, note: "Audio-Technica nennt 500 Stunden für konische Nadeln." };
    return { hours: 300, note: "Audio-Technica nennt 300 Stunden für elliptische Nadeln." };
  }
  if (/shure|m44|n44|whitelabel|white label|m35|m97/.test(n)) return { hours: 500, note: "Shure nennt 500 bis 1000 Stunden. Crate rechnet mit dem vorsichtigen Wert." };
  return null;
}
