import { camelotString, parseKey } from "../../../../shared/music";
import { sideOf } from "../../lib/format";
import { FONTS, stars, type PrintItem, type PrintOpts } from "./types";

type StickerData = PrintItem;
type StickerOpts = PrintOpts;

/** Ein Sticker. Alles in mm, damit Vorschau und Druck identisch sind. */
export function Sticker({ s, w, h, o }: { s: StickerData; w: number; h: number; o: StickerOpts }) {
  const { r } = s;
  const sides = new Map<string, StickerData["tracks"]>();
  for (const t of s.tracks) {
    const side = sideOf(t.position) || "·";
    sides.set(side, [...(sides.get(side) ?? []), t]);
  }
  const lines = s.tracks.length + sides.size;
  const headerH = 11;
  const avail = h - headerH - 3;
  // Schriftgröße so wählen, dass alle Tracks passen (in mm, 1pt ≈ 0.353mm)
  const twoCols = lines * 2.6 > avail && sides.size > 1;
  const perCol = twoCols ? Math.ceil(lines / 2) : lines;
  const lineH = Math.max(1.75, Math.min(3.2, avail / Math.max(1, perCol)));
  const fs = lineH * 0.78;
  const qrSize = o.showQr ? Math.min(11, headerH) : 0;
  const label = r.labels[0];

  const meta = (t: StickerData["tracks"][0]) => {
    const parts: string[] = [];
    if (o.showBpm && t.meta?.bpm) parts.push(String(Math.round(t.meta.bpm)));
    const c = parseKey(t.meta?.key);
    if (o.showCamelot && c) parts.push(camelotString(c));
    else if (o.showKey && t.meta?.key) parts.push(t.meta.key);
    if (o.showKey && o.showCamelot && c && t.meta?.key && !/^\d/.test(t.meta.key)) parts.push(t.meta.key);
    if (o.showEnergy && t.meta?.energy) parts.push(`E${t.meta.energy}`);
    if (o.showDuration && t.duration) parts.push(t.duration);
    return parts.join(" · ");
  };

  const sideBlocks = [...sides.entries()];
  const colA: typeof sideBlocks = [];
  const colB: typeof sideBlocks = [];
  if (twoCols) {
    let count = 0;
    for (const b of sideBlocks) {
      (count < perCol ? colA : colB).push(b);
      count += b[1].length + 1;
    }
  } else colA.push(...sideBlocks);

  const renderCol = (blocks: typeof sideBlocks) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      {blocks.map(([side, ts]) => (
        <div key={side}>
          {sides.size > 1 && (
            <div style={{ fontSize: `${fs * 0.9}mm`, lineHeight: `${lineH}mm`, fontWeight: 800, letterSpacing: "0.08em" }}>
              SIDE {side}
            </div>
          )}
          {ts.map((t) => (
            <div key={t.position} style={{ display: "flex", gap: "1mm", fontSize: `${fs}mm`, lineHeight: `${lineH}mm`, whiteSpace: "nowrap" }}>
              <span style={{ width: `${Math.max(2.2, Math.max(...s.tracks.map((x) => x.position.length)) * 0.72 + 0.3) * fs}mm`, flex: "none", fontWeight: 700 }}>{t.position}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                {t.meta?.artist && t.meta.artist !== r.artist ? `${t.meta.artist} – ` : ""}
                {t.title}
              </span>
              <span style={{ flex: "none", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{meta(t)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        width: `${w}mm`,
        height: `${h}mm`,
        padding: "2mm 2.5mm",
        boxSizing: "border-box",
        color: "#000",
        background: "#fff",
        fontFamily: o.font && o.font !== "modern" ? FONTS[o.font].body : "'Helvetica Neue', Arial, sans-serif",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", gap: "2mm", height: `${headerH}mm`, borderBottom: `0.3mm solid ${o.accent ?? "#000"}`, marginBottom: "1mm", flex: "none" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "3.3mm", lineHeight: "3.8mm", fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.artist}</div>
          <div style={{ fontSize: "2.8mm", lineHeight: "3.3mm", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
          <div style={{ fontSize: "2.1mm", lineHeight: "2.8mm", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#333" }}>
            {[label && `${label.name.replace(/\s\(\d+\)$/, "")} ${label.catno}`, r.year || null, o.showStyles ? r.styles.slice(0, 2).join(", ") : null, o.showShelf ? s.shelf : null, o.showRating ? stars(s.rating) : null, o.footer || null].filter(Boolean).join(" · ")}
          </div>
        </div>
        {o.showQr && s.qr && <img src={s.qr} style={{ width: `${qrSize - 1}mm`, height: `${qrSize - 1}mm` }} alt="" />}
      </div>
      <div style={{ display: "flex", gap: "2mm", flex: 1, minHeight: 0 }}>
        {renderCol(colA)}
        {twoCols && renderCol(colB)}
      </div>
    </div>
  );
}
