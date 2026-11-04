import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import QRCode from "qrcode";
import { db, getKV, realTracks, setKV, trackId, type Release, type TrackMeta } from "../lib/db";
import { discogsReleaseUrl, sideOf } from "../lib/format";
import { fetchMissingDetails, lookupAudioFor } from "../lib/sync";
import { toast } from "../lib/store";
import { Seg } from "../components/bits";
import { camelotString, parseKey } from "../../../shared/music";

/** Etiketten-Vorlagen (Maße in mm). Eigene Größe ist auch möglich. */
const TEMPLATES = {
  "a4-3x8": { name: "A4 · 70 × 37 mm (24 pro Blatt, z.B. Avery Zweckform 3475)", w: 70, h: 37, cols: 3, rows: 8, mx: 0, my: 0.5, gx: 0, gy: 0, page: "A4" },
  "a4-2x7": { name: "A4 · 99,1 × 38,1 mm (14 pro Blatt, z.B. Avery L7163)", w: 99.1, h: 38.1, cols: 2, rows: 7, mx: 4.7, my: 15.1, gx: 2.5, gy: 0, page: "A4" },
  "a4-2x4": { name: "A4 · 99,1 × 67,7 mm (8 pro Blatt, z.B. Avery L7165)", w: 99.1, h: 67.7, cols: 2, rows: 4, mx: 4.7, my: 13.1, gx: 2.5, gy: 0, page: "A4" },
  "a4-3x7-round": { name: "A4 · 63,5 × 38,1 mm (21 pro Blatt, z.B. Avery L7160)", w: 63.5, h: 38.1, cols: 3, rows: 7, mx: 7.2, my: 15.1, gx: 2.5, gy: 0, page: "A4" },
  "roll-62": { name: "Etikettendrucker 62 mm Endlos (Brother QL), 62 × 45 mm", w: 62, h: 45, cols: 1, rows: 1, mx: 0, my: 0, gx: 0, gy: 0, page: "62mm 45mm" },
  "roll-62-long": { name: "Etikettendrucker 62 mm Endlos, 62 × 70 mm", w: 62, h: 70, cols: 1, rows: 1, mx: 0, my: 0, gx: 0, gy: 0, page: "62mm 70mm" },
} as const;
type TplKey = keyof typeof TEMPLATES;

interface StickerOpts {
  template: TplKey;
  showBpm: boolean;
  showKey: boolean;
  showCamelot: boolean;
  showEnergy: boolean;
  showStyles: boolean;
  showShelf: boolean;
  showQr: boolean;
  showDuration: boolean;
  skip: number; // bereits benutzte Etiketten auf dem ersten Blatt
}
const DEFAULT_OPTS: StickerOpts = { template: "a4-2x7", showBpm: true, showKey: true, showCamelot: true, showEnergy: false, showStyles: true, showShelf: false, showQr: true, showDuration: false, skip: 0 };

interface StickerData {
  r: Release;
  tracks: { position: string; title: string; artist?: string; duration?: string; meta?: TrackMeta }[];
  shelf?: string;
  qr?: string;
}

export default function Stickers() {
  const [params] = useSearchParams();
  const preset = params.get("ids")?.split(",").map(Number).filter(Boolean);
  const [mode, setMode] = useState<"new" | "all" | "pick">(preset ? "pick" : "new");
  const [picked, setPicked] = useState<Set<number>>(new Set(preset ?? []));
  const [opts, setOpts] = useState<StickerOpts>(DEFAULT_OPTS);
  const [qrs, setQrs] = useState<Map<number, string>>(new Map());
  const [q, setQ] = useState("");

  useEffect(() => {
    getKV("stickerOpts", DEFAULT_OPTS).then((o) => setOpts({ ...DEFAULT_OPTS, ...o }));
  }, []);
  const upd = (p: Partial<StickerOpts>) => {
    const o = { ...opts, ...p };
    setOpts(o);
    void setKV("stickerOpts", o);
  };

  const data = useLiveQuery(async () => {
    const coll = await db.collection.orderBy("dateAdded").reverse().toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const [rels, metas, tracks] = await Promise.all([db.releases.bulkGet(ids), db.recordMeta.bulkGet(ids), db.tracks.where("releaseId").anyOf(ids).toArray()]);
    const tm = new Map(tracks.map((t) => [t.id, t]));
    return ids
      .map((id, i) => ({ id, r: rels[i], meta: metas[i] }))
      .filter((x) => x.r)
      .map(({ id, r, meta }) => ({
        r: r!,
        printed: meta?.stickerPrintedAt ?? null,
        shelf: meta?.shelf,
        tracks: realTracks(r!.tracklist).map((t, i) => ({ position: t.position, title: t.title, duration: t.duration, meta: tm.get(trackId(id, t.position, i)) })),
      }));
  });

  const selected = useMemo(() => {
    if (!data) return [];
    if (mode === "new") return data.filter((d) => !d.printed);
    if (mode === "pick") return data.filter((d) => picked.has(d.r.id));
    return data;
  }, [data, mode, picked]);

  useEffect(() => {
    if (!opts.showQr) return;
    const missing = selected.filter((s) => !qrs.has(s.r.id));
    if (!missing.length) return;
    Promise.all(missing.map(async (s) => [s.r.id, await QRCode.toDataURL(discogsReleaseUrl(s.r.id), { margin: 0, width: 160, errorCorrectionLevel: "L" })] as const)).then((pairs) =>
      setQrs((m) => new Map([...m, ...pairs])),
    );
  }, [selected, opts.showQr, qrs]);

  const tpl = TEMPLATES[opts.template];
  const perPage = tpl.cols * tpl.rows;
  const cells: (StickerData | null)[] = [...Array(opts.skip).fill(null), ...selected.map((s) => ({ ...s, qr: qrs.get(s.r.id) }))];
  const pages: (StickerData | null)[][] = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));

  const missingTracks = selected.filter((s) => !s.r.detailFetchedAt).length;
  const missingBpm = selected.reduce((n, s) => n + s.tracks.filter((t) => !t.meta?.bpm).length, 0);

  const print = async () => {
    window.print();
    if (selected.length && confirm(`${selected.length} Sticker als gedruckt markieren?`)) {
      const now = Date.now();
      await db.transaction("rw", db.recordMeta, async () => {
        for (const s of selected) {
          const m = await db.recordMeta.get(s.r.id);
          await db.recordMeta.put({ ...m, releaseId: s.r.id, stickerPrintedAt: now });
        }
      });
      toast("Als gedruckt markiert");
    }
  };

  const filtered = useMemo(() => (data ?? []).filter((d) => `${d.r.artist} ${d.r.title} ${d.r.labels[0]?.catno}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200), [data, q]);

  return (
    <>
      <style>{`@media print { @page { size: ${tpl.page}; margin: 0; } }`}</style>
      <div className="page-head no-print">
        <div>
          <h1>Sticker</h1>
          <div className="sub">
            {selected.length} Sticker · {pages.length} {tpl.cols * tpl.rows > 1 ? "Blatt" : "Etiketten"}
          </div>
        </div>
        <button className="btn primary" onClick={print} disabled={!selected.length}>
          Drucken
        </button>
      </div>
      <div className="page stack no-print">
        <Seg
          value={mode}
          options={[
            ["new", `Neue (${data?.filter((d) => !d.printed).length ?? 0})`],
            ["all", "Alle"],
            ["pick", "Auswahl"],
          ]}
          onChange={setMode}
        />
        {mode === "pick" && (
          <div className="card stack">
            <input className="input" placeholder="Platte suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="list" style={{ maxHeight: 260, overflow: "auto" }}>
              {filtered.map((d) => (
                <label key={d.r.id} className="row" style={{ padding: "6px 0" }}>
                  <input
                    type="checkbox"
                    checked={picked.has(d.r.id)}
                    onChange={(e) => {
                      const s = new Set(picked);
                      if (e.target.checked) s.add(d.r.id);
                      else s.delete(d.r.id);
                      setPicked(s);
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }} className="rec-title">
                    {d.r.artist} – {d.r.title}
                  </span>
                  {d.printed && <span className="badge ok">gedruckt</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        {(missingTracks > 0 || missingBpm > 0) && (
          <div className="card stack">
            {missingTracks > 0 && (
              <div className="row">
                <span className="sub">{missingTracks} Platten ohne Tracklist</span>
                <span className="spacer" />
                <button className="btn small" onClick={() => fetchMissingDetails("collection").catch((e) => toast(e.message))}>
                  laden
                </button>
              </div>
            )}
            {missingBpm > 0 && (
              <div className="row">
                <span className="sub">{missingBpm} Tracks ohne BPM</span>
                <span className="spacer" />
                <button className="btn small" onClick={() => lookupAudioFor(selected.flatMap((s) => s.tracks.map((t) => t.meta?.id).filter(Boolean) as string[])).then((n) => toast(`${n} ergänzt`))}>
                  automatisch suchen
                </button>
              </div>
            )}
          </div>
        )}

        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Format & Inhalt</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <select className="input" value={opts.template} onChange={(e) => upd({ template: e.target.value as TplKey })}>
              {Object.entries(TEMPLATES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="grid2">
              {(
                [
                  ["showBpm", "BPM"],
                  ["showKey", "Tonart"],
                  ["showCamelot", "Camelot (8A …)"],
                  ["showEnergy", "Energie"],
                  ["showDuration", "Länge"],
                  ["showStyles", "Styles"],
                  ["showShelf", "Regalplatz"],
                  ["showQr", "QR-Code zu Discogs"],
                ] as [keyof StickerOpts, string][]
              ).map(([k, l]) => (
                <label key={k} className="row sub">
                  <input type="checkbox" checked={Boolean(opts[k])} onChange={(e) => upd({ [k]: e.target.checked })} /> {l}
                </label>
              ))}
            </div>
            {perPage > 1 && (
              <label className="field">
                Bereits benutzte Etiketten auf dem ersten Blatt überspringen
                <input className="input" inputMode="numeric" value={opts.skip} onChange={(e) => upd({ skip: Math.max(0, Math.min(perPage - 1, Number(e.target.value) || 0)) })} />
              </label>
            )}
            <span className="sub">Beim Drucken „Tatsächliche Größe / 100 %“ wählen und Kopf-/Fußzeilen ausschalten.</span>
          </div>
        </details>

        <h2>Vorschau</h2>
        <div className="stack" style={{ alignItems: "center" }}>
          {selected.slice(0, 6).map((s) => (
            <div key={s.r.id} style={{ background: "#fff", borderRadius: 6, boxShadow: "0 2px 12px rgba(0,0,0,.4)" }}>
              <Sticker s={{ ...s, qr: qrs.get(s.r.id) }} w={tpl.w} h={tpl.h} o={opts} />
            </div>
          ))}
          {selected.length === 0 && <div className="empty">Alles bestickert. Neue Platten landen automatisch hier.</div>}
        </div>
      </div>

      <div className="print-area print-only">
        {pages.map((cellsOnPage, pi) => (
          <div
            key={pi}
            style={{
              pageBreakAfter: "always",
              breakAfter: "page",
              paddingLeft: `${tpl.mx}mm`,
              paddingTop: `${tpl.my}mm`,
              display: "grid",
              gridTemplateColumns: `repeat(${tpl.cols}, ${tpl.w}mm)`,
              gridAutoRows: `${tpl.h}mm`,
              columnGap: `${tpl.gx}mm`,
              rowGap: `${tpl.gy}mm`,
            }}
          >
            {cellsOnPage.map((c, i) => (c ? <Sticker key={i} s={c} w={tpl.w} h={tpl.h} o={opts} /> : <div key={i} />))}
          </div>
        ))}
      </div>
    </>
  );
}

/** Ein Sticker. Alles in mm, damit Vorschau und Druck identisch sind. */
function Sticker({ s, w, h, o }: { s: StickerData; w: number; h: number; o: StickerOpts }) {
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
              <span style={{ width: `${fs * 2.2}mm`, flex: "none", fontWeight: 700 }}>{t.position}</span>
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
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", gap: "2mm", height: `${headerH}mm`, borderBottom: "0.3mm solid #000", marginBottom: "1mm", flex: "none" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "3.3mm", lineHeight: "3.8mm", fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.artist}</div>
          <div style={{ fontSize: "2.8mm", lineHeight: "3.3mm", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
          <div style={{ fontSize: "2.1mm", lineHeight: "2.8mm", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#333" }}>
            {[label && `${label.name.replace(/\s\(\d+\)$/, "")} ${label.catno}`, r.year || null, o.showStyles ? r.styles.slice(0, 2).join(", ") : null, o.showShelf ? s.shelf : null].filter(Boolean).join(" · ")}
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
