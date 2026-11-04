// Crate-Profil: was Freunde von dir sehen. Wird auf Server und Gerät gleich geprüft.

export type LinkKind = "instagram" | "soundcloud" | "mixcloud" | "bandcamp" | "spotify" | "youtube" | "tiktok" | "residentadvisor" | "discogs" | "web";

export interface ProfileLink {
  url: string;
  kind: LinkKind;
}

export interface CrateProfile {
  /** DJ-Name, sonst Discogs-Name */
  djName?: string;
  bio?: string;
  location?: string;
  links: ProfileLink[];
  /** Lieblings-Styles, höchstens 6 */
  styles: string[];
  /** Platte des Moments aus der eigenen Kiste */
  spotlight?: { id: number; title: string; artist: string; cover?: string };
  updatedAt?: number;
}

const KINDS: [RegExp, LinkKind][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)soundcloud\.com$/, "soundcloud"],
  [/(^|\.)mixcloud\.com$/, "mixcloud"],
  [/(^|\.)bandcamp\.com$/, "bandcamp"],
  [/(^|\.)spotify\.com$/, "spotify"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(ra\.co|residentadvisor\.net)$/, "residentadvisor"],
  [/(^|\.)discogs\.com$/, "discogs"],
];

export const LINK_LABEL: Record<LinkKind, string> = {
  instagram: "Instagram",
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  bandcamp: "Bandcamp",
  spotify: "Spotify",
  youtube: "YouTube",
  tiktok: "TikTok",
  residentadvisor: "Resident Advisor",
  discogs: "Discogs",
  web: "Website",
};

/** Link prüfen und Dienst erkennen. „@name“ wird als Instagram verstanden. Ungültiges ergibt null. */
export function parseLink(raw: string): ProfileLink | null {
  let s = raw.trim();
  if (!s) return null;
  if (/^@[\w.]{2,30}$/.test(s)) s = `https://instagram.com/${s.slice(1)}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
  u.protocol = "https:";
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const kind = KINDS.find(([re]) => re.test(host))?.[1] ?? "web";
  return { url: u.toString().replace(/\/$/, ""), kind };
}

/** Kurzer Text für einen Link-Knopf, z. B. „@djfranz“ oder „feuerpfeil.de“ */
export function linkText(l: ProfileLink): string {
  const u = new URL(l.url);
  const path = u.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  if (["instagram", "soundcloud", "mixcloud", "tiktok"].includes(l.kind) && path) return `@${path.replace(/^@/, "")}`;
  if (l.kind === "bandcamp") return u.hostname.replace(/\.bandcamp\.com$/, "").replace(/^www\./, "");
  if (l.kind === "web") return u.hostname.replace(/^www\./, "");
  return LINK_LABEL[l.kind];
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");

/** Eingaben bereinigen und begrenzen */
export function sanitizeProfile(p: Partial<CrateProfile> & { links?: (ProfileLink | string)[] }): CrateProfile {
  const links = (p.links ?? [])
    .map((l) => (typeof l === "string" ? parseLink(l) : parseLink(l?.url ?? "")))
    .filter((l): l is ProfileLink => Boolean(l))
    .filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i)
    .slice(0, 5);
  const sp = p.spotlight;
  const spotlight =
    sp && Number.isInteger(Number(sp.id)) && Number(sp.id) > 0
      ? { id: Number(sp.id), title: clean(sp.title, 120), artist: clean(sp.artist, 80), cover: typeof sp.cover === "string" && /^https:\/\/i\.discogs\.com\//.test(sp.cover) ? sp.cover.slice(0, 400) : undefined }
      : undefined;
  return {
    djName: clean(p.djName, 40) || undefined,
    bio: clean(p.bio, 300) || undefined,
    location: clean(p.location, 60) || undefined,
    links,
    styles: [...new Set((p.styles ?? []).map((s) => clean(s, 30)).filter(Boolean))].slice(0, 6),
    spotlight,
  };
}
