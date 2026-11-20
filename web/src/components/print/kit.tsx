// Bausteine für alles, was gedruckt wird: Farben je Look, Seiten-Kästchen, Tonart-Etikett, Energie-Balken.
// Gestaltung wie ein Plattenlabel: Schwarz auf Weiß, klare Linien, Zahlen in Mono. Farbe nur als kleine Fläche,
// damit auch ein Tintenstrahler zu Hause nicht leer läuft und ein Schwarz-Weiß-Laser alles sauber druckt.
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import { camelotString, parseKey } from "../../../../shared/music";
import { sideOf } from "../../lib/format";
import { splitVersion } from "../../../../shared/trackTitle";
import { CAMELOT_COLORS } from "../bits";
import { DATA, onColor, type PrintOpts, type PrintTrack } from "./types";

export type CardTheme = "light" | "dark" | "accent" | "cover";

export const DEFAULT_ACCENT = "#0b0b0b";
const INK = "#0b0b0b";

export interface Pal {
  bg: string;
  fg: string;
  muted: string;
  /** Haarlinie */
  hair: string;
  /** Füllung für Kästchen (Seite, Streifen) */
  mark: string;
  /** Schrift auf dieser Füllung */
  markInk: string;
  /** Farbe für kleine Zeichen (Energie, Stempel): gut lesbar auf dem Grund */
  sign: string;
}

function luminance(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function palette(theme: CardTheme, o: PrintOpts): Pal {
  const accent = o.mono ? INK : (o.accent ?? DEFAULT_ACCENT);
  // „Cover“ (weichgezeichnetes Bild) gibt es nicht mehr: viel Tinte, wenig Lesbarkeit
  const th = theme === "cover" || (theme === "accent" && o.mono) ? "light" : theme;
  if (th === "dark") {
    const light = luminance(accent) > 0.25;
    return { bg: INK, fg: "#ffffff", muted: "#b9b9b9", hair: "rgba(255,255,255,.4)", mark: light ? accent : "#ffffff", markInk: light ? onColor(accent) : INK, sign: light ? accent : "#ffffff" };
  }
  if (th === "accent") {
    const fg = onColor(accent);
    const dark = fg === "#ffffff";
    return { bg: accent, fg, muted: dark ? "rgba(255,255,255,.8)" : "rgba(0,0,0,.66)", hair: dark ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.4)", mark: fg, markInk: accent, sign: fg };
  }
  // Weiß: Farbe als Fläche fürs Seiten-Kästchen; helle Farben (Lime, Gelb) taugen nicht für dünne Zeichen
  return { bg: "#ffffff", fg: INK, muted: "#5a5a5a", hair: "rgba(0,0,0,.32)", mark: accent, markInk: onColor(accent), sign: luminance(accent) > 0.45 ? INK : accent };
}

export const mm = (v: number) => `${v.toFixed(2)}mm`;

/** Version in Klammern: etwas kleiner, aber gut lesbar (Mixe sind beim Auflegen wichtig) */
export const VERSION_SCALE = 0.86;
export const clamp = (n: number): React.CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden" });

/** Titel mit Version in eigener Zeile: „Keep Pushin'“ / „(Grant's Bouncing Dub Mix)“ */
export function TitleLines({ artist, title, muted, lineH }: { artist: string | null; title: string; muted: string; lineH: number }) {
  const { main, version } = splitVersion(title);
  return (
    <>
      <span style={clamp(2)}>
        {artist ? <span style={{ color: muted }}>{artist} – </span> : null}
        {main}
      </span>
      {version && <span style={{ ...clamp(2), fontSize: `${VERSION_SCALE}em`, lineHeight: mm(lineH * VERSION_SCALE), color: muted }}>{version}</span>}
    </>
  );
}

/** Einzeilig (Obi, Sticker): Version kleiner direkt dahinter */
export function InlineVersion({ title }: { title: string }) {
  const { main, version } = splitVersion(title);
  if (!version) return <>{title}</>;
  return (
    <>
      {main} <span style={{ fontSize: `${VERSION_SCALE}em`, opacity: 0.75 }}>{version}</span>
    </>
  );
}

export function groupSides(tracks: PrintTrack[]) {
  const sides = new Map<string, PrintTrack[]>();
  for (const t of tracks) {
    const s = sideOf(t.position) || "·";
    sides.set(s, [...(sides.get(s) ?? []), t]);
  }
  return [...sides.entries()];
}

export const bpmText = (t: PrintTrack) => (t.meta?.bpm ? `${t.meta.tempoCheck === "unsicher" ? "~" : ""}${Math.round(t.meta.bpm)}` : "");

/** Tempo-Spanne einer Seite oder Platte: „112–124“ */
export function bpmRange(tracks: PrintTrack[]): string {
  const b = tracks.map((t) => t.meta?.bpm).filter((x): x is number => Boolean(x)).map(Math.round);
  if (!b.length) return "";
  const lo = Math.min(...b), hi = Math.max(...b);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/** Seiten-Kästchen: Buchstabe hell auf dunkler Fläche, wie der Aufdruck „SIDE A“ auf dem Label */
export function SideTag({ side, size, pal }: { side: string; size: number; pal: Pal }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: mm(size), height: mm(size), padding: `0 ${mm(size * 0.16)}`, boxSizing: "border-box", background: pal.mark, color: pal.markInk, ...DATA, fontWeight: 800, fontSize: mm(size * 0.68), lineHeight: 1, flex: "none" }}>{side}</span>
  );
}

/**
 * Tonart als Etikett. Farbig: Camelot-Farbe als Fläche (die Farben kennt jeder, der mit dem Rad mischt).
 * Schwarz-Weiß: nur Rahmen, Moll (A) gefüllt, Dur (B) leer, damit man es auch ohne Farbe unterscheidet.
 */
export function KeyTag({ k, size, pal, o, unsure }: { k?: string | null; size: number; pal: Pal; o: PrintOpts; unsure?: boolean }) {
  const c = parseKey(k);
  if (!c || !o.showCamelot) return k && o.showKey ? <span style={{ ...DATA, fontSize: mm(size * 0.86), fontWeight: 700 }}>{k}</span> : null;
  const colored = !o.mono;
  const filled = !colored && c.letter === "A";
  return (
    <span
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        minWidth: mm(size * (unsure ? 2.5 : 2.05)),
        textAlign: "center",
        padding: `${mm(size * 0.1)} ${mm(size * 0.22)}`,
        boxSizing: "border-box",
        borderRadius: mm(size * 0.18),
        background: colored ? CAMELOT_COLORS[c.num - 1] : filled ? pal.fg : "transparent",
        color: colored ? "#0b0b0b" : filled ? pal.bg : pal.fg,
        boxShadow: colored ? undefined : `inset 0 0 0 0.25mm ${pal.fg}`,
        ...DATA,
        fontWeight: 800,
        fontSize: mm(size * 0.8),
        lineHeight: 1.12,
      }}
    >
      {camelotString(c)}
      {unsure ? "?" : ""}
    </span>
  );
}

/** Nur geschätzte Tonart (die Messung war sich nicht sicher): bekommt im Druck ein „?“ */
export const keyGuess = (t?: { keySource?: string } | null) => t?.keySource === "Analyse (Schätzung)";

/** Energie als fünf Balken */
export function Bars({ v, size, pal }: { v?: number | null; size: number; pal: Pal }) {
  if (v == null) return null;
  return (
    <span style={{ display: "inline-flex", gap: mm(size * 0.11), alignItems: "flex-end", height: mm(size * 0.8) }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} style={{ width: mm(size * 0.17), height: mm(size * (0.3 + i * 0.1)), background: v >= i * 2 - 1 ? pal.sign : "transparent", boxShadow: v >= i * 2 - 1 ? undefined : `inset 0 0 0 0.12mm ${pal.hair}` }} />
      ))}
    </span>
  );
}

/** Eigene Zeile als Stempel: schräg, im Rahmen, wie mit dem Stempelkissen auf die Hülle gedrückt */
export function Stamp({ text, size, pal }: { text: string; size: number; pal: Pal }) {
  return (
    <span style={{ display: "inline-block", maxWidth: "100%", padding: `${mm(size * 0.32)} ${mm(size * 0.6)}`, border: `${mm(Math.max(0.35, size * 0.14))} solid ${pal.sign}`, color: pal.sign, ...DATA, fontWeight: 800, fontSize: mm(size), lineHeight: 1.1, letterSpacing: "0.06em", textTransform: "uppercase", rotate: "-3deg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box" }}>{text}</span>
  );
}

/** Zeile in kleinen Versalien (Katalognummer, Label, Land) */
export const capsLine = (size: number, color: string): React.CSSProperties => ({ ...DATA, fontSize: mm(size), lineHeight: 1.25, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color });

export const cleanLabel = (name?: string) => (name ?? "").replace(/\s\(\d+\)$/, "");
export const catnoOf = (label?: { catno?: string }) => (label?.catno && label.catno.toLowerCase() !== "none" ? label.catno : "");
