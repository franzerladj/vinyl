// Einleger für die transparente Außenhülle: von außen lesbar, verdeckt das Cover nicht.
// Alle Maße in mm, damit Vorschau und Druck exakt gleich aussehen.
import { camelotString, parseKey } from "../../../../shared/music";
import { sideOf } from "../../lib/format";
import { CAMELOT_COLORS } from "../bits";
import type { PrintItem, PrintOpts, PrintTrack } from "./types";

export type CardTheme = "light" | "dark" | "cover";

const THEMES: Record<CardTheme, { bg: string; fg: string; muted: string; line: string; chip: string }> = {
  light: { bg: "#ffffff", fg: "#0b0b0b", muted: "#6e6e73", line: "rgba(0,0,0,.14)", chip: "rgba(0,0,0,.06)" },
  dark: { bg: "#0b0b0c", fg: "#ffffff", muted: "#a1a1a6", line: "rgba(255,255,255,.18)", chip: "rgba(255,255,255,.1)" },
  cover: { bg: "#111", fg: "#ffffff", muted: "rgba(255,255,255,.72)", line: "rgba(255,255,255,.25)", chip: "rgba(255,255,255,.14)" },
};

const BRAND = "'Archivo', 'Inter', system-ui, sans-serif";
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
  const t = THEMES[theme];
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
  const footerH = o.showQr ? 16 : 10;
  const avail = h - pad * 2 - headerH - footerH - 6;
  const lines = s.tracks.length + sides.length * 0.6;
  const lineH = Math.max(3.4, Math.min(7, avail / Math.max(1, lines)));
  const fs = lineH * 0.6;

  return (
    <div style={{ position: "relative", width: mm(w), height: mm(h), background: t.bg, color: t.fg, overflow: "hidden", fontFamily: "'Inter', -apple-system, system-ui, sans-serif", boxSizing: "border-box" }}>
      <Backdrop theme={theme} cover={r.cover || r.thumb} />
      <div style={{ position: "relative", zIndex: 1, height: "100%", padding: mm(pad), boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        {/* Kopf */}
        <div style={{ display: "flex", gap: mm(4), minHeight: mm(headerH), alignItems: "flex-start" }}>
          {o.showCover && (r.cover || r.thumb) && (
            <img src={r.cover || r.thumb} alt="" style={{ width: mm(coverSize), height: mm(coverSize), objectFit: "cover", borderRadius: mm(1), flex: "none", boxShadow: "0 1mm 3mm rgba(0,0,0,.25)" }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: mm(2.6), fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: t.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[label?.catno && label.catno !== "none" ? label.catno : null, r.year || null].filter(Boolean).join("  ·  ")}
            </div>
            <div style={{ fontFamily: BRAND, fontStretch: "125%", fontWeight: 900, fontSize: mm(artistSize), lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", marginTop: mm(1.4), display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {r.artist}
            </div>
            <div style={{ fontFamily: BRAND, fontWeight: 500, fontSize: mm(Math.max(3.2, artistSize * 0.55)), lineHeight: 1.15, marginTop: mm(1.2), display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</div>
          </div>
        </div>

        <div style={{ height: "0.3mm", background: t.line, margin: `${mm(3.5)} 0 ${mm(2.5)}` }} />

        {/* Tracks nach Seiten */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: mm(lineH * 0.35) }}>
          {sides.map(([side, ts]) => (
            <div key={side} style={{ display: "flex", gap: mm(3) }}>
              {sides.length > 1 && (
                <div style={{ fontFamily: BRAND, fontStretch: "125%", fontWeight: 900, fontSize: mm(lineH * 1.25), lineHeight: mm(lineH), width: mm(lineH * 1.4), flex: "none", color: t.muted }}>{side}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {ts.map((tr) => (
                  <div key={tr.position} style={{ display: "flex", alignItems: "center", gap: mm(1.6), height: mm(lineH), fontSize: mm(fs), whiteSpace: "nowrap" }}>
                    <span style={{ width: mm(fs * 1.9), flex: "none", fontWeight: 700, color: t.muted, fontVariantNumeric: "tabular-nums" }}>{tr.position}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontWeight: 500 }}>
                      {tr.meta?.artist && tr.meta.artist !== r.artist ? <span style={{ color: t.muted }}>{tr.meta.artist} – </span> : null}
                      {tr.title}
                    </span>
                    {o.showDuration && tr.duration && <span style={{ color: t.muted, fontVariantNumeric: "tabular-nums" }}>{tr.duration}</span>}
                    {o.showBpm && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: mm(fs * 1.9), textAlign: "right" }}>{tr.meta?.bpm ? Math.round(tr.meta.bpm) : ""}</span>}
                    {(o.showCamelot || o.showKey) && (
                      <span style={{ minWidth: mm(fs * 2.4), textAlign: "right" }}>{o.showCamelot ? <Pill k={tr.meta?.key} size={fs} /> : <span style={{ fontWeight: 700 }}>{tr.meta?.key}</span>}</span>
                    )}
                    {o.showEnergy && <Bars v={tr.meta?.energy} size={fs} color={theme === "light" ? "#ff6a00" : "#ff9a3c"} off={t.line} />}
                  </div>
                ))}
              </div>
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
              {[label?.name.replace(/\s\(\d+\)$/, ""), r.country, o.showShelf && s.shelf ? `Regal ${s.shelf}` : null].filter(Boolean).join("  ·  ")}
            </div>
          </div>
          {o.showQr && s.qr && <img src={s.qr} alt="" style={{ width: mm(14), height: mm(14), flex: "none" }} />}
        </div>
      </div>
    </div>
  );
}

/** Obi-Streifen: schmal und hoch, steckt seitlich in der Hülle wie bei japanischen Pressungen */
export function ObiStrip({ s, w, h, o, theme }: { s: PrintItem; w: number; h: number; o: PrintOpts; theme: CardTheme }) {
  const t = THEMES[theme];
  const { r } = s;
  const label = r.labels[0];
  const pad = 4.5;
  const inner = w - pad * 2;
  const fs = 2.55;
  const lineH = 4.1;
  const sidesCount = new Set(s.tracks.map((t) => sideOf(t.position))).size;
  const tracksH = s.tracks.length * lineH + sidesCount * 1.2;
  // Platz für den senkrechten Text: Höhe minus Kopf, Tracks, Fuß
  const availH = h - pad * 2 - 12 - tracksH - (o.showQr ? 20 : 12);
  const longest = Math.max(4, ...r.artist.split(/\s+/).map((w) => w.length));
  const artistSize = Math.max(6, Math.min(inner * 0.42, availH / (longest * 1.02), (availH * 2) / (r.artist.length * 1.02)));
  const titleLongest = Math.max(4, ...r.title.split(/\s+/).map((w) => w.length));
  const titleSize = Math.max(3.4, Math.min(artistSize * 0.45, availH / (titleLongest * 0.62), (availH * 2) / (r.title.length * 0.62)));

  return (
    <div style={{ position: "relative", width: mm(w), height: mm(h), background: t.bg, color: t.fg, overflow: "hidden", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      <Backdrop theme={theme} cover={r.cover || r.thumb} />
      <div style={{ position: "relative", zIndex: 1, height: "100%", padding: mm(pad), boxSizing: "border-box", display: "flex", flexDirection: "column", gap: mm(3) }}>
        <div style={{ fontSize: mm(2.4), fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: t.muted, display: "flex", justifyContent: "space-between" }}>
          <span>{label?.catno && label.catno !== "none" ? label.catno : ""}</span>
          <span>{r.year || ""}</span>
        </div>
        <div style={{ height: "0.3mm", background: t.line }} />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: mm(1.5), writingMode: "vertical-rl", overflow: "hidden" }}>
          <div style={{ fontFamily: BRAND, fontStretch: "125%", fontWeight: 900, fontSize: mm(artistSize), lineHeight: 0.95, textTransform: "uppercase", letterSpacing: "-0.01em", maxHeight: "100%", overflow: "hidden" }}>{r.artist}</div>
          <div style={{ fontFamily: BRAND, fontWeight: 500, fontSize: mm(titleSize), lineHeight: 1.05, color: t.muted, maxHeight: "100%", overflow: "hidden" }}>{r.title}</div>
        </div>
        <div style={{ height: "0.3mm", background: t.line }} />
        <div>
          {groupSides(s.tracks).map(([side, ts]) => (
            <div key={side} style={{ marginBottom: mm(1.2) }}>
              {ts.map((tr) => (
                <div key={tr.position} style={{ display: "flex", alignItems: "center", gap: mm(1.2), height: mm(lineH), fontSize: mm(fs), whiteSpace: "nowrap" }}>
                  <span style={{ width: mm(5), fontWeight: 800, color: t.muted }}>{tr.position}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tr.title}</span>
                  {o.showBpm && <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{tr.meta?.bpm ? Math.round(tr.meta.bpm) : ""}</span>}
                  {(o.showCamelot || o.showKey) && <Pill k={tr.meta?.key} size={fs} />}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: mm(2) }}>
          <div style={{ fontSize: mm(2.2), color: t.muted, lineHeight: 1.3, minWidth: 0 }}>
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label?.name.replace(/\s\(\d+\)$/, "")}</div>
            {o.showStyles && <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.styles.slice(0, 2).join(" · ")}</div>}
            {o.showShelf && s.shelf && <div>Regal {s.shelf}</div>}
          </div>
          {o.showQr && s.qr && <img src={s.qr} alt="" style={{ width: mm(12), height: mm(12), flex: "none" }} />}
        </div>
      </div>
    </div>
  );
}
