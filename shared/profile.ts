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
  /** Setup wie auf einem Technical Rider, ein freier Text je Platz */
  setup?: Partial<Record<GearSlot, string>>;
  /** Womit aufgelegt wird */
  plays?: PlayMode;
  updatedAt?: number;
}

export type GearSlot = "decks" | "carts" | "mixer" | "fx" | "phones" | "monitors" | "sound" | "care";
export type PlayMode = "vinyl" | "hybrid" | "dvs";

export const PLAY_LABEL: Record<PlayMode, string> = { vinyl: "Nur Vinyl", hybrid: "Vinyl & digital", dvs: "DVS" };

/** Plätze im Rider mit Vorschlägen (gängige Geräte, frei überschreibbar) */
export const GEAR: { id: GearSlot; label: string; short: string; placeholder: string; suggest: string[] }[] = [
  {
    id: "decks",
    label: "Plattenspieler",
    short: "Decks",
    placeholder: "z. B. 2× Technics SL-1210 MK2",
    suggest: ["2× Technics SL-1210 MK2", "2× Technics SL-1210 MK7", "2× Technics SL-1210GR", "2× Technics SL-1200G", "2× Pioneer PLX-1000", "2× Reloop RP-8000 MK2", "2× Reloop RP-7000 MK2", "2× Audio-Technica AT-LP140XP", "2× Vestax PDX-2000"],
  },
  {
    id: "carts",
    label: "Tonabnehmer",
    short: "Nadeln",
    placeholder: "z. B. Ortofon Concorde Nightclub",
    suggest: ["Ortofon Concorde Nightclub", "Ortofon Concorde Club", "Ortofon Concorde Pro S", "Ortofon Concorde Elite", "Ortofon Concorde MkII Club", "Ortofon Concorde MkII Mix", "Ortofon OM Pro S", "Ortofon 2M Red", "Shure M44-7", "Shure Whitelabel", "Audio-Technica AT-XP5", "Audio-Technica AT-XP7"],
  },
  {
    id: "mixer",
    label: "Mixer",
    short: "Mixer",
    placeholder: "z. B. Allen & Heath Xone:92",
    suggest: ["Allen & Heath Xone:92", "Allen & Heath Xone:96", "Allen & Heath Xone:23C", "Pioneer DJM-900NXS2", "Pioneer DJM-A9", "Pioneer DJM-V10", "Rane MP2015", "Rane Seventy-Two", "Bozak AR-6", "E&S DJR400", "Condesa Carmen V", "Isonoe ISO420", "Union Audio Orbit", "Varia RDM20", "Formula Sound FF6000", "Urei 1620"],
  },
  {
    id: "fx",
    label: "Effekte & Isolator",
    short: "FX",
    placeholder: "z. B. Pioneer RMX-1000",
    suggest: ["Pioneer RMX-1000", "Pioneer EFX-1000", "Roland SP-404MKII", "Boss RE-202 Space Echo", "Roland RE-201 Space Echo"],
  },
  {
    id: "phones",
    label: "Kopfhörer",
    short: "Kopfhörer",
    placeholder: "z. B. Sennheiser HD 25",
    suggest: ["Sennheiser HD 25", "Technics RP-DJ1210", "AIAIAI TMA-2", "Pioneer HDJ-X10", "Audio-Technica ATH-M50x", "Beyerdynamic DT 770 Pro"],
  },
  {
    id: "monitors",
    label: "Monitore",
    short: "Monitore",
    placeholder: "z. B. Genelec 8030",
    suggest: ["Genelec 8030", "Neumann KH 120", "Adam Audio A7V", "Yamaha HS8", "KRK Rokit 5", "Focal Alpha 65", "Pioneer VM-80"],
  },
  {
    id: "sound",
    label: "Anlage",
    short: "Anlage",
    placeholder: "z. B. Klipsch La Scala zu Hause",
    suggest: ["Funktion-One", "Void Acoustics", "Klipsch La Scala", "Altec Lansing A7", "JBL 4430", "Martin Audio", "d&b audiotechnik", "Hi-Fi zu Hause"],
  },
  {
    id: "care",
    label: "Plattenpflege",
    short: "Pflege",
    placeholder: "z. B. Pro-Ject VC-S",
    suggest: ["Pro-Ject VC-S", "Degritter", "Knosti Disco-Antistat", "Okki Nokki", "Ultraschall-Waschmaschine", "Carbonbürste"],
  },
];

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
    setup: sanitizeSetup(p.setup),
    plays: typeof p.plays === "string" && Object.hasOwn(PLAY_LABEL, p.plays) ? p.plays : undefined,
  };
}

function sanitizeSetup(raw: unknown): CrateProfile["setup"] {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<GearSlot, string>> = {};
  for (const g of GEAR) {
    const v = clean((raw as Record<string, unknown>)[g.id], 80);
    if (v) out[g.id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Ist im Profil überhaupt etwas eingetragen? */
export const profileEmpty = (p: CrateProfile) => !p.djName && !p.bio && !p.location && !p.links.length && !p.styles.length && !p.spotlight && !p.setup && !p.plays;
