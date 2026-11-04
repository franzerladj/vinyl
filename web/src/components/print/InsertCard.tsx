// Einleger für die transparente Außenhülle: von außen lesbar, verdeckt das Cover nicht.
// Alle Maße in mm, damit Vorschau und Druck exakt gleich aussehen.
import { camelotString, parseKey } from "../../../../shared/music";
import { sideOf } from "../../lib/format";
import { CAMELOT_COLORS } from "../bits";
import { FONTS, onColor, stars, type PrintItem, type PrintOpts, type PrintTrack } from "./types";

export type CardTheme = "light" | "dark" | "cover" | "accent";
type ThemeColors = { bg: string; fg: string; muted: string; line: string; chip: string };

const THEMES: Record<Exclude<CardTheme, "accent">, ThemeColors> = {
  light: { bg: "#ffffff", fg: "#0b0b0b", muted: "#6e6e73", line: "rgba(0,0,0,.14)", chip: "rgba(0,0,0,.06)" },
  dark: { bg: "#0b0b0c", fg: "#ffffff", muted: "#a1a1a6", line: "rgba(255,255,255,.18)", chip: "rgba(255,255,255,.1)" },
  cover: { bg: "#111", fg: "#ffffff", muted: "rgba(255,255,255,.72)", line: "rgba(255,255,255,.25)", chip: "rgba(255,255,255,.14)" },
};

export const DEFAULT_ACCENT = "#ff6a00";

function themeFor(theme: CardTheme, accent = DEFAULT_ACCENT): ThemeColors {
  if (theme !== "accent") return THEMES[theme];
  const fg = onColor(accent);
  const dark = fg === "#ffffff";
  return { bg: accent, fg, muted: dark ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.6)", line: dark ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.2)", chip: dark ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.08)" };
}

/** Farbe für Energie-Balken: Akzent, auf Akzent-Hintergrund die Schriftfarbe */
const barColor = (theme: CardTheme, t: ThemeColors, accent = DEFAULT_ACCENT) => (theme === "accent" ? t.fg : accent);

const mm = (v: number) => `${v.toFixed(2)}mm`;

function groupSides(tracks: PrintTrack[]) {
  const sides = new Map<string, PrintTrack[]>();
  for (const t of tracks) {
    const s = sideOf(t.position) || "·";
    sides.set(s, [...(sides.get(s) ?? []), t]);
  }
  return [...sides.entries()];
}

function Pill({ k, size }: { k?: string | null; size: number }) {
  const c = parseKey(k);
  if (!c) return k ? <span style={{ fontSize: mm(size * 0.8), fontWeight: 700 }}>{k}</span> : null;
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: mm(size * 2.3),
        textAlign: "center",
        padding: `${mm(size * 0.12)} ${mm(size * 0.35)}`,
        borderRadius: mm(size),
        background: CAMELOT_COLORS[c.num - 1],
        color: "#111",
        fontWeight: 800,
        fontSize: mm(size * 0.78),
        lineHeight: 1.1,
      }}
    >
      {camelotString(c)}
    </span>
  );
}

function Bars({ v, size, color, off }: { v?: number | null; size: number; color: string; off: string }) {
  if (v == null) return null;
  return (
    <span style={{ display: "inline-flex", gap: mm(size * 0.12), alignItems: "flex-end", height: mm(size * 0.8) }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} style={{ width: mm(size * 0.18), height: mm(size * (0.3 + i * 0.1)), borderRadius: mm(0.2), background: v >= i * 2 - 1 ? color : off }} />
      ))}
    </span>
  );
}

function Backdrop({ theme, cover }: { theme: CardTheme; cover?: string }) {
  if (theme !== "cover" || !cover) return null;
  return (
    <>
      <img src={cover} alt="" style={{ position: "absolute", inset: "-12%", width: "124%", height: "124%", objectFit: "cover", filter: "blur(9mm) saturate(1.5)", zIndex: 0 }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.7))", zIndex: 0 }} />
    </>
  );
}

/** Hochformat- oder Quadrat-Karte (A6, 100 × 100 mm …) */
export function InsertCard({ s, w, h, o, theme }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme }) {
  const t = themeFor(theme, o.accent);
  const F = FONTS[o.font ?? "modern"];
  const BRAND = F.head;
  const { r } = s;
  const pad = Math.max(5, w * 0.06);
  const inner = w - pad * 2;
  const label = r.labels[0];
  const sides = groupSides(s.tracks);
  const coverSize = o.showCover ? Math.min(30, inner * 0.33) : 0;
  // Archivo Expanded Black: ein Großbuchstabe ist etwa 1 em breit. Längstes Wort muss in eine Zeile passen.
  const textW = inner - coverSize - (coverSize ? 4 : 0);
  const longest = Math.max(4, ...r.artist.split(/\s+/).map((w) => w.length));
  const artistSize = Math.max(3.6, Math.min(8, textW / (longest * 1.02), (textW * 2) / (r.artist.length * 1.02)));
  const headerH = Math.max(coverSize, artistSize * 2.4 + 9);
  const footerH = (o.showQr ? 16 : 10) + (o.footer ? 3 : 0);
  const avail = h - pad * 2 - headerH - footerH - 6;
  // Nur Spalten zeigen, zu denen es Daten gibt
  const hasBpm = o.showBpm && s.tracks.some((t) => t.meta?.bpm);
  const hasKey = (o.showCamelot || o.showKey) && s.tracks.some((t) => t.meta?.key);
  const hasEnergy = o.showEnergy && s.tracks.some((t) => t.meta?.energy != null);
  const hasDur = o.showDuration && s.tracks.some((t) => t.duration);
  const sideLen = Math.max(1, ...sides.map(([sd]) => sd.length));
  const posLen = Math.max(1, ...s.tracks.map((t) => t.position.length));
  const fullTitle = (t: PrintTrack) => `${t.meta?.artist && t.meta.artist !== r.artist ? `${t.meta.artist} – ` : ""}${t.title}`;
  // Größte Zeilenhöhe suchen, bei der alle Titel (max. 2 Zeilen umgebrochen) hineinpassen
  // Lange LPs (Doppel-LP, Compilations): Seiten auf zwei Spalten verteilen
  const layout = (lh: number, cols: number) => {
    const f = lh * 0.6;
    const colW = (inner - (cols - 1) * 4) / cols;
    const sideW = sides.length > 1 ? sideLen * lh * 0.95 + 1 : 0;
    const posW = posLen * f * 0.68 + 1;
    const metaW = (hasBpm ? f * 2.2 : 0) + (hasKey ? f * 2.6 : 0) + (hasEnergy ? f * 1.4 : 0) + (hasDur ? f * 2.6 : 0) + 2;
    const textW = Math.max(8, colW - sideW - posW - metaW - (sides.length > 1 ? 3 : 0));
    const perLine = textW / (f * 0.53);
    const sideH = sides.map(([, ts]) => ts.reduce((a, t) => a + Math.min(2, Math.ceil(fullTitle(t).length / perLine)) * lh * 0.92 + lh * 0.12, 0) + lh * 0.35);
    // Seiten der Reihe nach auf Spalten verteilen, höchste Spalte zählt
    const per = Math.ceil(sides.length / cols);
    let total = 0;
    for (let c = 0; c < cols; c++) total = Math.max(total, sideH.slice(c * per, (c + 1) * per).reduce((a, b) => a + b, 0));
    return { f, sideW, posW, total, per };
  };
  let cols = 1;
  let lineH = 7.5;
  while (lineH > 3.4 && layout(lineH, 1).total > avail) lineH -= 0.1;
  // Passt es selbst in kleinster Schrift nicht, auf zwei Spalten verteilen
  if (layout(lineH, 1).total > avail && sides.length > 1 && w >= 100) {
    cols = 2;
    lineH = 5;
    while (lineH > 3 && layout(lineH, 2).total > avail) lineH -= 0.1;
  }
  const { f: fs, sideW, posW, per } = layout(lineH, cols);
  const columns = Array.from({ length: cols }, (_, c) => sides.slice(c * per, (c + 1) * per));

  return (
    <div style={{ position: "relative", width: mm(w), height: mm(h), background: t.bg, color: t.fg, overflow: "hidden", fontFamily: F.body, boxSizing: "border-box" }}>
      <Backdrop theme={theme} cover={r.cover || r.thumb} />
      <div style={{ position: "relative", zIndex: 1, height: "100%", padding: mm(pad), boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        {/* Kopf */}
        <div style={{ display: "flex", gap: mm(4), minHeight: mm(headerH), alignItems: "flex-start" }}>
          {o.showCover && (r.cover || r.thumb) && (
            <img src={r.cover || r.thumb} alt="" style={{ width: mm(coverSize), height: mm(coverSize), objectFit: "cover", borderRadius: mm(1), flex: "none", boxShadow: "0 1mm 3mm rgba(0,0,0,.25)" }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: mm(2.6), fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: t.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[label?.catno && label.catno !== "none" ? label.catno : null, r.year || null, o.showRating ? stars(s.rating) : null].filter(Boolean).join("  ·  ")}
            </div>
            <div style={{ fontFamily: BRAND, fontStretch: F.stretch, fontWeight: F.weight, fontSize: mm(artistSize), lineHeight: 0.98, letterSpacing: F.upper ? "-0.02em" : "-0.01em", textTransform: F.upper ? "uppercase" : "none", marginTop: mm(1.4), display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {r.artist}
            </div>
            <div style={{ fontFamily: BRAND, fontWeight: 500, fontSize: mm(Math.max(3.2, artistSize * 0.55)), lineHeight: 1.15, marginTop: mm(1.2), display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</div>
          </div>
        </div>

        <div style={{ height: "0.3mm", background: t.line, margin: `${mm(3.5)} 0 ${mm(2.5)}` }} />

        {/* Tracks nach Seiten */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: mm(4) }}>
          {columns.map((colSides, ci) => (
        <div key={ci} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: mm(lineH * 0.35) }}>
          {colSides.map(([side, ts]) => (
            <div key={side} style={{ display: "flex", gap: mm(3) }}>
              {sides.length > 1 && (
                <div style={{ fontFamily: BRAND, fontStretch: F.stretch, fontWeight: F.weight, fontSize: mm(lineH * 1.15), lineHeight: mm(lineH), width: mm(sideW), flex: "none", color: t.muted, letterSpacing: "-0.02em" }}>{side}</div>
              )}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: mm(lineH * 0.12) }}>
                {ts.map((tr) => (
                  <div key={tr.position} style={{ display: "flex", alignItems: "flex-start", gap: mm(1.6), minHeight: mm(lineH), fontSize: mm(fs), lineHeight: mm(lineH * 0.92) }}>
                    <span style={{ width: mm(posW), flex: "none", fontWeight: 700, color: t.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{tr.position}</span>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 500, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {tr.meta?.artist && tr.meta.artist !== r.artist ? <span style={{ color: t.muted }}>{tr.meta.artist} – </span> : null}
                      {tr.title}
                    </span>
                    {hasDur && <span style={{ color: t.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{tr.duration}</span>}
                    {hasBpm && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: mm(fs * 1.9), textAlign: "right" }}>{tr.meta?.bpm ? Math.round(tr.meta.bpm) : ""}</span>}
                    {hasKey && <span style={{ minWidth: mm(fs * 2.4), textAlign: "right" }}>{o.showCamelot ? <Pill k={tr.meta?.key} size={fs} /> : <span style={{ fontWeight: 700 }}>{tr.meta?.key}</span>}</span>}
                    {hasEnergy && (
                      <span style={{ paddingTop: mm(fs * 0.15) }}>
                        <Bars v={tr.meta?.energy} size={fs} color={barColor(theme, t, o.accent)} off={t.line} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
          ))}
        </div>

        {/* Fuß */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: mm(3), minHeight: mm(footerH - 2), marginTop: mm(2) }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {o.showStyles && r.styles.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: mm(1), marginBottom: mm(1.4) }}>
                {r.styles.slice(0, 3).map((st) => (
                  <span key={st} style={{ fontSize: mm(2.3), fontWeight: 600, padding: `${mm(0.4)} ${mm(1.6)}`, borderRadius: mm(2), background: t.chip }}>
                    {st}
                  </span>
                ))}
              </div>
            )}
            <div style={{ fontSize: mm(2.4), color: t.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[label?.name.replace(/\s\(\d+\)$/, ""), r.country, o.showShelf && s.shelf ? `Regal ${s.shelf}` : null, o.showAdded && s.added ? `seit ${s.added}` : null].filter(Boolean).join("  ·  ")}
            </div>
            {o.footer && <div style={{ fontSize: mm(2.4), fontWeight: 700, marginTop: mm(0.8), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: theme === "light" ? o.accent ?? DEFAULT_ACCENT : t.fg }}>{o.footer}</div>}
          </div>
          {o.showQr && s.qr && <img src={s.qr} alt="" style={{ width: mm(14), height: mm(14), flex: "none" }} />}
        </div>
      </div>
    </div>
  );
}

/** Obi-Streifen: schmal und hoch, steckt seitlich in der Hülle wie bei japanischen Pressungen */
export function ObiStrip({ s, w, h, o, theme, front }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme; front?: boolean }) {
  const t = themeFor(theme, o.accent);
  const F = FONTS[o.font ?? "modern"];
  const BRAND = F.head;
  const { r } = s;
  const label = r.labels[0];
  const pad = 4.5;
  const inner = w - pad * 2;
  const fs = 2.55;
  const lineH = 4.1;
  const sidesCount = new Set(s.tracks.map((t) => sideOf(t.position))).size;
  const tracksH = front ? 10 : s.tracks.length * lineH + sidesCount * 1.2;
  // Platz für den senkrechten Text: Höhe minus Kopf, Tracks, Fuß
  const availH = h - pad * 2 - 12 - tracksH - (o.showQr ? 20 : 12);
  const longest = Math.max(4, ...r.artist.split(/\s+/).map((w) => w.length));
  const artistSize = Math.max(6, Math.min(inner * 0.42, availH / (longest * 1.02), (availH * 2) / (r.artist.length * 1.02)));
  const titleLongest = Math.max(4, ...r.title.split(/\s+/).map((w) => w.length));
  const titleSize = Math.max(3.4, Math.min(artistSize * 0.45, availH / (titleLongest * 0.62), (availH * 2) / (r.title.length * 0.62)));

  return (
    <div style={{ position: "relative", width: mm(w), height: mm(h), background: t.bg, color: t.fg, overflow: "hidden", fontFamily: F.body }}>
      <Backdrop theme={theme} cover={r.cover || r.thumb} />
      <div style={{ position: "relative", zIndex: 1, height: "100%", padding: mm(pad), boxSizing: "border-box", display: "flex", flexDirection: "column", gap: mm(3) }}>
        <div style={{ fontSize: mm(2.4), fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: t.muted, display: "flex", justifyContent: "space-between" }}>
          <span>{label?.catno && label.catno !== "none" ? label.catno : ""}</span>
          <span>{r.year || ""}</span>
        </div>
        <div style={{ height: "0.3mm", background: t.line }} />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: mm(1.5), writingMode: "vertical-rl", overflow: "hidden" }}>
          <div style={{ fontFamily: BRAND, fontStretch: F.stretch, fontWeight: F.weight, fontSize: mm(artistSize), lineHeight: 0.95, textTransform: F.upper ? "uppercase" : "none", letterSpacing: "-0.01em", maxHeight: "100%", overflow: "hidden" }}>{r.artist}</div>
          <div style={{ fontFamily: BRAND, fontWeight: 500, fontSize: mm(titleSize), lineHeight: 1.05, color: t.muted, maxHeight: "100%", overflow: "hidden" }}>{r.title}</div>
        </div>
        <div style={{ height: "0.3mm", background: t.line }} />
        {front ? (
          <ObiSummary s={s} t={t} />
        ) : (
        <div>
            {groupSides(s.tracks).map(([side, ts]) => (
              <div key={side} style={{ marginBottom: mm(1.2) }}>
                {ts.map((tr) => (
                  <div key={tr.position} style={{ display: "flex", alignItems: "center", gap: mm(1.2), height: mm(lineH), fontSize: mm(fs), whiteSpace: "nowrap" }}>
                    <span style={{ width: mm(Math.max(...s.tracks.map((x) => x.position.length)) * fs * 0.7 + 0.8), flex: "none", fontWeight: 800, color: t.muted }}>{tr.position}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tr.title}</span>
                    {o.showBpm && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{tr.meta?.bpm ? Math.round(tr.meta.bpm) : ""}</span>}
                    {(o.showCamelot || o.showKey) && <Pill k={tr.meta?.key} size={fs} />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: mm(2) }}>
          <div style={{ fontSize: mm(2.2), color: t.muted, lineHeight: 1.3, minWidth: 0 }}>
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label?.name.replace(/\s\(\d+\)$/, "")}</div>
            {o.showStyles && <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.styles.slice(0, 2).join(" · ")}</div>}
            {o.showShelf && s.shelf && <div>Regal {s.shelf}</div>}
            {o.showRating && s.rating ? <div>{stars(s.rating)}</div> : null}
            {front && o.footer && <div style={{ fontWeight: 700, color: t.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.footer}</div>}
          </div>
          {!front && o.showQr && s.qr && <img src={s.qr} alt="" style={{ width: mm(12), height: mm(12), flex: "none" }} />}
        </div>
      </div>
    </div>
  );
}

/** Kurzfassung für die Vorderseite des Knick-Obis: Tempo-Spanne und Keys */
function ObiSummary({ s, t }: { s: PrintItem; t: ThemeColors }) {
  const bpms = s.tracks.map((x) => x.meta?.bpm).filter(Boolean).map((b) => Math.round(b!));
  const keys = [...new Set(s.tracks.map((x) => x.meta?.key).filter(Boolean))].slice(0, 4);
  if (!bpms.length && !keys.length) return <div style={{ fontSize: mm(2.4), color: t.muted }}>{s.tracks.length} Tracks</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: mm(1.2) }}>
      {bpms.length > 0 && (
        <span style={{ fontSize: mm(3.2), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {Math.min(...bpms) === Math.max(...bpms) ? bpms[0] : `${Math.min(...bpms)}–${Math.max(...bpms)}`}
          <span style={{ fontSize: mm(2.2), fontWeight: 600, color: t.muted }}> BPM</span>
        </span>
      )}
      {keys.map((k) => (
        <Pill key={k} k={k} size={2.6} />
      ))}
    </div>
  );
}

/**
 * Knick-Obi: Rückseite | Falz | Vorderseite. Wird um die linke Kante der Hülle gelegt.
 * Der Falz läuft senkrecht, deshalb stehen beide Hälften nach dem Knicken richtig herum.
 */
export function ObiFold({ s, w, h, o, theme }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme }) {
  const t = themeFor(theme, o.accent);
  const spine = 4;
  const panel = (w - spine) / 2;
  const label = s.r.labels[0];
  return (
    <div style={{ position: "relative", display: "flex", width: mm(w), height: mm(h), background: t.bg, overflow: "hidden" }}>
      <ObiStrip s={s} w={panel} h={h} o={o} theme={theme} />
      <div style={{ position: "relative", width: mm(spine), height: "100%", background: t.bg, borderLeft: `0.2mm dashed ${t.line}`, borderRight: `0.2mm dashed ${t.line}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ writingMode: "vertical-rl", fontSize: mm(2), fontWeight: 800, letterSpacing: "0.2em", color: t.muted, fontFamily: "'Inter Variable', 'Inter', system-ui, sans-serif", whiteSpace: "nowrap" }}>
          {[label?.catno && label.catno !== "none" ? label.catno : "", s.r.artist].filter(Boolean).join("  ·  ").toUpperCase()}
        </span>
      </div>
      <ObiStrip s={s} w={panel} h={h} o={o} theme={theme} front />
    </div>
  );
}
