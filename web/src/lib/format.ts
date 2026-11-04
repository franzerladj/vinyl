import type { DArtist, BasicInformation } from "./types";

export const artistName = (artists: DArtist[] = []) =>
  artists
    .map((a, i) => (a.anv || a.name).replace(/\s\(\d+\)$/, "") + (i < artists.length - 1 ? (a.join ? ` ${a.join} `.replace(" , ", ", ") : ", ") : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

export const cleanName = (s: string) => s.replace(/\s\(\d+\)$/, "");

export const formatLine = (b: Pick<BasicInformation, "formats">) =>
  (b.formats ?? []).map((f) => [f.qty && f.qty !== "1" ? `${f.qty}×` : "", f.name, ...(f.descriptions ?? [])].join(" ").trim()).join(" + ");

export const money = (v: number | null | undefined, currency = "EUR") =>
  v == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(v);

export const dateDE = (iso?: string | number) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "");

/** Vinyl-Seite aus Position: "A1" → "A", "B" → "B", "1" → "" */
export const sideOf = (position: string) => position.match(/^([A-Z]+)/)?.[1] ?? "";

export const discogsReleaseUrl = (id: number) => `https://www.discogs.com/release/${id}`;
export const discogsSellUrl = (id: number) => `https://www.discogs.com/sell/release/${id}`;
