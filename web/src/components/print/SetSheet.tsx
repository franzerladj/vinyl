// Setliste zum Ausdrucken: der Spickzettel fürs Pult, im selben Look wie Einleger und Sticker.
// A4 hoch, Schwarz auf Weiß. Je Track: Nummer, Seite, Titel und Artist, Platte mit Katalognummer
// (zum Wiederfinden in der Kiste), Tempo, Tonart, Energie und die eigene Mix-Notiz.
import type { DJSet, Release, TrackMeta } from "../../lib/db";
import { FONTS, headStyle, MONO, type PrintOpts } from "./types";
import { Bars, capsLine, catnoOf, cleanLabel, InlineVersion, KeyTag, mm, palette } from "./kit";

const dateText = (d?: string) => (d ? new Date(d).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "");

export function SetSheet({ set, tracks, rels, o }: { set: DJSet; tracks: TrackMeta[]; rels?: Map<number, Release>; o: PrintOpts }) {
  const pal = palette("light", o);
  const F = FONTS[o.font ?? "schmal"] ?? FONTS.schmal;
  const W = 210, pad = 14;
  const inner = W - pad * 2;
  // Zeilenhöhe so, dass übliche Sets (bis etwa 30 Tracks) auf eine Seite passen; längere laufen auf die nächste
  const n = Math.max(1, tracks.length);
  const rowH = Math.max(6.4, Math.min(12.5, 214 / n));
  const fs = Math.max(3, Math.min(4.3, rowH * 0.42));
  const bpms = tracks.map((t) => t.bpm).filter((b): b is number => Boolean(b)).map(Math.round);
  const meta = [dateText(set.date), set.venue, set.start ? `${set.start}${set.end ? `–${set.end}` : ""} Uhr` : null].filter(Boolean).join(" · ");
  const name = set.name || "Set";
  const headSize = Math.max(9, Math.min(22, inner / (Math.max(6, name.length) * F.cw)));
  let lastRel = -1;
  return (
    <div style={{ width: mm(W), minHeight: "296mm", padding: `${mm(pad)} ${mm(pad)} ${mm(10)}`, boxSizing: "border-box", background: "#fff", color: pal.fg, fontFamily: F.body }}>
      <div style={{ display: "flex", alignItems: "center", gap: mm(2.5), ...capsLine(2.8, pal.fg) }}>
        <span style={{ fontWeight: 800 }}>Setliste</span>
        <span style={{ flex: 1, height: "0.25mm", background: pal.fg }} />
        <span>{tracks.length} Tracks{bpms.length ? ` · ${Math.min(...bpms) === Math.max(...bpms) ? bpms[0] : `${Math.min(...bpms)}–${Math.max(...bpms)}`} BPM` : ""}</span>
      </div>
      <div style={{ ...headStyle(o.font), fontSize: mm(headSize), lineHeight: 0.95, marginTop: mm(4) }}>{name}</div>
      {meta && <div style={{ fontSize: mm(4.2), fontWeight: 600, marginTop: mm(2) }}>{meta}</div>}
      <div style={{ height: "0.6mm", background: pal.fg, margin: `${mm(4)} 0 ${mm(1)}` }} />
      <div style={{ display: "flex", ...capsLine(2.1, pal.muted), padding: `${mm(1)} 0`, borderBottom: `0.2mm solid ${pal.hair}` }}>
        <span style={{ width: mm(9) }}>Nr.</span>
        <span style={{ width: mm(11) }}>Seite</span>
        <span style={{ flex: 1 }}>Track</span>
        <span style={{ width: mm(14), textAlign: "right" }}>BPM</span>
        <span style={{ width: mm(15), textAlign: "right" }}>Tonart</span>
        <span style={{ width: mm(12), textAlign: "right" }}>Energie</span>
      </div>
      {tracks.map((t, i) => {
        const r = rels?.get(t.releaseId);
        const sameRecord = t.releaseId === lastRel;
        lastRel = t.releaseId;
        const note = set.mixNotes?.[t.id];
        return (
          <div key={`${t.id}-${i}`} style={{ display: "flex", alignItems: "flex-start", minHeight: mm(rowH), padding: `${mm(rowH * 0.13)} 0`, boxSizing: "border-box", borderBottom: `0.2mm solid ${pal.hair}`, breakInside: "avoid", pageBreakInside: "avoid", fontSize: mm(fs), lineHeight: 1.22 }}>
            <span style={{ width: mm(9), flex: "none", fontFamily: MONO, fontWeight: 800 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ width: mm(11), flex: "none", fontFamily: MONO, fontWeight: 700, color: pal.muted }}>{t.position}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <InlineVersion title={t.title} />
                <span style={{ fontWeight: 500, color: pal.muted }}> · {t.artist}</span>
              </span>
              <span style={{ display: "block", ...capsLine(fs * 0.58, pal.muted), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {sameRecord ? "gleiche Platte" : [r?.title, cleanLabel(r?.labels[0]?.name), catnoOf(r?.labels[0])].filter(Boolean).join(" · ")}
              </span>
              {note && <span style={{ display: "block", fontSize: mm(fs * 0.84), fontStyle: "italic", marginTop: mm(0.4) }}>{note}</span>}
            </span>
            <span style={{ width: mm(14), flex: "none", textAlign: "right", fontFamily: MONO, fontWeight: 800, fontSize: mm(fs * 1.12) }}>{t.bpm ? `${t.tempoCheck === "unsicher" ? "~" : ""}${Math.round(t.bpm)}` : ""}</span>
            <span style={{ width: mm(15), flex: "none", textAlign: "right" }}>
              <KeyTag k={t.key} size={fs} pal={pal} o={{ ...o, showCamelot: true, showKey: true }} />
            </span>
            <span style={{ width: mm(12), flex: "none", textAlign: "right", paddingTop: mm(fs * 0.14) }}>
              <Bars v={t.energy} size={fs} pal={pal} />
            </span>
          </div>
        );
      })}
      {set.notes && <div style={{ marginTop: mm(4), fontSize: mm(3.4), lineHeight: 1.35, whiteSpace: "pre-wrap" }}>{set.notes}</div>}
      {o.footer && <div style={{ marginTop: mm(5), ...capsLine(2.4, pal.muted) }}>{o.footer}</div>}
    </div>
  );
}
