import { NavBar } from "../components/ui";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import QRCode from "qrcode";
import { db, getKV, realTracks, setKV, trackId } from "../lib/db";
import { discogsReleaseUrl } from "../lib/format";
import { fetchMissingDetails, lookupAudioFor } from "../lib/sync";
import { toast } from "../lib/store";
import { Empty, haptic, Seg } from "../components/bits";
import { IconPrint } from "../components/icons";
import { Sticker } from "../components/print/Sticker";
import { InsertCard, ObiFold, ObiStrip, type CardTheme } from "../components/print/InsertCard";
import type { Layout, PrintItem, PrintOpts } from "../components/print/types";

type Kind = "card" | "obi" | "sticker";

/** Einleger-Formate (mm). A4 hoch = 210 × 297 */
const CARD_LAYOUTS = {
  a6: { name: "A6-Karte · 105 × 148 mm · 4 pro A4", w: 105, h: 148, cols: 2, rows: 2, mx: 0, my: 0.5, gx: 0, gy: 0, page: "A4", cutMarks: true },
  sq: { name: "Quadrat · 100 × 100 mm · 4 pro A4", w: 100, h: 100, cols: 2, rows: 2, mx: 5, my: 48.5, gx: 0, gy: 0, page: "A4", cutMarks: true },
  a5: { name: "A5-Karte · 148 × 210 mm · 2 pro A4 quer", w: 148, h: 210, cols: 2, rows: 1, mx: 0.5, my: 0, gx: 0, gy: 0, page: "A4 landscape", cutMarks: true },
} satisfies Record<string, Layout>;
const OBI_LAYOUTS = {
  "obi-fold": { name: "Knick-Obi · 2 × 40 mm + Falz · 2 pro A4", w: 84, h: 287, cols: 2, rows: 1, mx: 21, my: 5, gx: 0, gy: 0, page: "A4", cutMarks: true },
  obi: { name: "Einzelstreifen · 50 × 287 mm · 4 pro A4 (ohne Knick)", w: 50, h: 287, cols: 4, rows: 1, mx: 5, my: 5, gx: 0, gy: 0, page: "A4", cutMarks: true },
} satisfies Record<string, Layout>;
/** Etiketten-Vorlagen für Sticker */
const STICKER_LAYOUTS = {
  "a4-2x7": { name: "A4 · 99,1 × 38,1 mm (14/Blatt, z.B. Avery L7163)", w: 99.1, h: 38.1, cols: 2, rows: 7, mx: 4.7, my: 15.1, gx: 2.5, gy: 0, page: "A4" },
  "a4-3x8": { name: "A4 · 70 × 37 mm (24/Blatt, z.B. Avery 3475)", w: 70, h: 37, cols: 3, rows: 8, mx: 0, my: 0.5, gx: 0, gy: 0, page: "A4" },
  "a4-2x4": { name: "A4 · 99,1 × 67,7 mm (8/Blatt, z.B. Avery L7165)", w: 99.1, h: 67.7, cols: 2, rows: 4, mx: 4.7, my: 13.1, gx: 2.5, gy: 0, page: "A4" },
  "a4-3x7": { name: "A4 · 63,5 × 38,1 mm (21/Blatt, z.B. Avery L7160)", w: 63.5, h: 38.1, cols: 3, rows: 7, mx: 7.2, my: 15.1, gx: 2.5, gy: 0, page: "A4" },
  "roll-62": { name: "Etikettendrucker 62 mm, 62 × 45 mm (Brother QL)", w: 62, h: 45, cols: 1, rows: 1, mx: 0, my: 0, gx: 0, gy: 0, page: "62mm 45mm" },
  "roll-62-long": { name: "Etikettendrucker 62 mm, 62 × 70 mm", w: 62, h: 70, cols: 1, rows: 1, mx: 0, my: 0, gx: 0, gy: 0, page: "62mm 70mm" },
} satisfies Record<string, Layout>;
const ALL_LAYOUTS: Record<string, Layout> = { ...CARD_LAYOUTS, ...OBI_LAYOUTS, ...STICKER_LAYOUTS };

interface Opts extends PrintOpts {
  kind: Kind;
  cardLayout: keyof typeof CARD_LAYOUTS;
  obiLayout: keyof typeof OBI_LAYOUTS;
  stickerLayout: keyof typeof STICKER_LAYOUTS;
  theme: CardTheme;
  skip: number;
}
const DEFAULTS: Opts = {
  kind: "card",
  cardLayout: "a6",
  obiLayout: "obi-fold",
  stickerLayout: "a4-2x7",
  theme: "light",
  showBpm: true,
  showKey: true,
  showCamelot: true,
  showEnergy: true,
  showStyles: true,
  showShelf: false,
  showQr: true,
  showDuration: false,
  showCover: true,
  skip: 0,
};

const KIND_LABEL: Record<Kind, string> = { card: "Einleger", obi: "Obi-Streifen", sticker: "Sticker" };

export default function Stickers() {
  const [params] = useSearchParams();
  const preset = params.get("ids")?.split(",").map(Number).filter(Boolean);
  const [mode, setMode] = useState<"new" | "all" | "pick">(preset ? "pick" : "new");
  const [picked, setPicked] = useState<Set<number>>(new Set(preset ?? []));
  const [opts, setOpts] = useState<Opts>(DEFAULTS);
  const [qrs, setQrs] = useState<Map<string, string>>(new Map());
  const [q, setQ] = useState("");

  useEffect(() => {
    getKV("printOpts", DEFAULTS).then((o) => setOpts({ ...DEFAULTS, ...o }));
  }, []);
  const upd = (p: Partial<Opts>) => {
    const o = { ...opts, ...p };
    setOpts(o);
    void setKV("printOpts", o);
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

  // QR-Codes passend zum Farbschema (auf dunklen Karten weiß)
  const darkQr = opts.kind !== "sticker" && opts.theme !== "light";
  const qrKey = (id: number) => `${id}:${darkQr ? "d" : "l"}`;
  useEffect(() => {
    if (!opts.showQr) return;
    const missing = selected.filter((s) => !qrs.has(qrKey(s.r.id)));
    if (!missing.length) return;
    Promise.all(
      missing.map(
        async (s) =>
          [qrKey(s.r.id), await QRCode.toDataURL(discogsReleaseUrl(s.r.id), { margin: 0, width: 220, errorCorrectionLevel: "L", color: darkQr ? { dark: "#ffffff", light: "#00000000" } : { dark: "#000000", light: "#ffffff" } })] as const,
      ),
    ).then((pairs) => setQrs((m) => new Map([...m, ...pairs])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, opts.showQr, darkQr, qrs]);

  const layoutKey = opts.kind === "card" ? opts.cardLayout : opts.kind === "obi" ? opts.obiLayout : opts.stickerLayout;
  const tpl = ALL_LAYOUTS[layoutKey];
  const perPage = tpl.cols * tpl.rows;
  const items: (PrintItem | null)[] = [...Array(opts.skip).fill(null), ...selected.map((s) => ({ ...s, qr: qrs.get(qrKey(s.r.id)) }))];
  const pages: (PrintItem | null)[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));

  const missingTracks = selected.filter((s) => !s.r.detailFetchedAt).length;
  const missingBpm = selected.reduce((n, s) => n + s.tracks.filter((t) => !t.meta?.bpm).length, 0);

  const render = (s: PrintItem, key: string | number) =>
    opts.kind === "card" ? (
      <InsertCard key={key} s={s} w={tpl.w} h={tpl.h} o={opts} theme={opts.theme} />
    ) : opts.kind === "obi" ? (
      opts.obiLayout === "obi-fold" ? <ObiFold key={key} s={s} w={tpl.w} h={tpl.h} o={opts} theme={opts.theme} /> : <ObiStrip key={key} s={s} w={tpl.w} h={tpl.h} o={opts} theme={opts.theme} />
    ) : (
      <Sticker key={key} s={s} w={tpl.w} h={tpl.h} o={opts} />
    );

  const print = async () => {
    haptic();
    window.print();
    if (selected.length && confirm(`${selected.length} Platten als beschriftet markieren?`)) {
      const now = Date.now();
      await db.transaction("rw", db.recordMeta, async () => {
        for (const s of selected) {
          const m = await db.recordMeta.get(s.r.id);
          await db.recordMeta.put({ ...m, releaseId: s.r.id, stickerPrintedAt: now });
        }
      });
      toast("Als beschriftet markiert");
    }
  };

  const filtered = useMemo(() => (data ?? []).filter((d) => `${d.r.artist} ${d.r.title} ${d.r.labels[0]?.catno}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200), [data, q]);
  // Vorschau verkleinern, damit eine Karte auf den Handy-Bildschirm passt
  const previewScale = Math.min(1, (Math.min(window.innerWidth, 760) - 64) / ((tpl.w / 25.4) * 96), opts.kind === "obi" ? (opts.obiLayout === "obi-fold" ? 0.5 : 0.62) : 1);
  const newCount = data?.filter((d) => !d.printed).length ?? 0;

  return (
    <>
      <style>{`@media print { @page { size: ${tpl.page}; margin: 0; } }`}</style>
      <NavBar backLabel="Zurück" title="Beschriften" titleOnScroll />
      <div className="page-head no-print" style={{ paddingTop: 0 }}>
        <div>
          <h1>Beschriften</h1>
          <div className="sub">
            {selected.length} {KIND_LABEL[opts.kind]} · {pages.length} {perPage > 1 ? (pages.length === 1 ? "Blatt" : "Blätter") : "Etiketten"}
          </div>
        </div>
        <button className="btn primary" onClick={print} disabled={!selected.length}>
          <IconPrint /> Drucken
        </button>
      </div>
      <div className="page stack no-print">
        <Seg
          value={opts.kind}
          options={[
            ["card", "Einleger"],
            ["obi", "Obi"],
            ["sticker", "Sticker"],
          ]}
          onChange={(kind) => upd({ kind, skip: 0 })}
        />
        <p className="sub" style={{ margin: "-2px 2px 0" }}>
          {opts.kind === "card" && "Karte, die vor dem Cover in die transparente Außenhülle kommt. Von außen lesbar, nichts klebt auf dem Original."}
          {opts.kind === "obi" && "Papierstreifen, der wie bei japanischen Pressungen um die linke Kante der Hülle gelegt wird: vorne Artist und Titel, hinten die Tracks mit BPM und Key."}
          {opts.kind === "sticker" && "Etikett zum Aufkleben auf die Außenhülle. Passend für gängige Etikettenbögen und Etikettendrucker."}
        </p>

        {/* Vorschau */}
        {selected.length > 0 ? (
          <div className="preview-scroll">
            {selected.slice(0, 8).map((s) => (
              <div key={s.r.id} style={{ width: `${tpl.w * previewScale}mm`, height: `${tpl.h * previewScale}mm` }}>
                <div style={{ transform: `scale(${previewScale})`, transformOrigin: "top left" }}>{render({ ...s, qr: qrs.get(qrKey(s.r.id)) }, s.r.id)}</div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title={mode === "new" ? "Alles beschriftet" : "Nichts ausgewählt"}>Neue Platten landen automatisch hier.</Empty>
        )}

        <Seg
          value={mode}
          options={[
            ["new", `Neue (${newCount})`],
            ["all", `Alle (${data?.length ?? 0})`],
            ["pick", "Auswahl"],
          ]}
          onChange={setMode}
        />
        {mode === "pick" && (
          <div className="card stack">
            <input className="input" placeholder="Platte suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="list" style={{ maxHeight: 280, overflow: "auto" }}>
              {filtered.map((d) => (
                <label key={d.r.id} className="row" style={{ padding: "8px 0", minHeight: 44 }}>
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
                  {d.printed && <span className="badge ok">erledigt</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        {(missingTracks > 0 || missingBpm > 0) && (
          <div className="group">
            {missingTracks > 0 && (
              <button className="group-row" onClick={() => fetchMissingDetails("collection").catch((e) => toast(e.message))}>
                <span>{missingTracks} Platten ohne Tracklist</span>
                <span className="chev" style={{ color: "var(--accent)" }}>Laden</span>
              </button>
            )}
            {missingBpm > 0 && (
              <button className="group-row" onClick={() => lookupAudioFor(selected.flatMap((s) => s.tracks.map((t) => t.meta?.id).filter(Boolean) as string[])).then((n) => toast(`${n} Tracks ergänzt`))}>
                <span>{missingBpm} Tracks ohne BPM</span>
                <span className="chev" style={{ color: "var(--accent)" }}>Suchen</span>
              </button>
            )}
          </div>
        )}

        <h3>Format</h3>
        {opts.kind === "card" && (
          <select className="input" value={opts.cardLayout} onChange={(e) => upd({ cardLayout: e.target.value as Opts["cardLayout"], skip: 0 })}>
            {Object.entries(CARD_LAYOUTS).map(([k, t]) => (
              <option key={k} value={k}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {opts.kind === "sticker" && (
          <select className="input" value={opts.stickerLayout} onChange={(e) => upd({ stickerLayout: e.target.value as Opts["stickerLayout"], skip: 0 })}>
            {Object.entries(STICKER_LAYOUTS).map(([k, t]) => (
              <option key={k} value={k}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {opts.kind === "obi" && (
          <>
            <select className="input" value={opts.obiLayout} onChange={(e) => upd({ obiLayout: e.target.value as Opts["obiLayout"], skip: 0 })}>
              {Object.entries(OBI_LAYOUTS).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.name}
                </option>
              ))}
            </select>
            {opts.obiLayout === "obi-fold" && (
              <p className="tiny" style={{ margin: 0 }}>
                Entlang der gestrichelten Linien knicken und um die linke Kante der Hülle legen: rechte Hälfte vorne, linke Hälfte hinten. Der Falz läuft senkrecht, deshalb stehen beide Seiten richtig herum.
              </p>
            )}
          </>
        )}

        {opts.kind !== "sticker" && (
          <>
            <h3>Look</h3>
            <Seg
              value={opts.theme}
              options={[
                ["light", "Weiß"],
                ["dark", "Schwarz"],
                ["cover", "Cover-Farben"],
              ]}
              onChange={(theme) => upd({ theme })}
            />
          </>
        )}

        <h3>Inhalt</h3>
        <div className="group">
          {(
            [
              ["showBpm", "BPM"],
              ["showCamelot", "Camelot-Key (8A …)"],
              ["showKey", "Tonart (Am …)"],
              ["showEnergy", "Energie"],
              ["showDuration", "Länge"],
              ["showStyles", "Styles"],
              ["showShelf", "Regalplatz"],
              ["showQr", "QR-Code zu Discogs"],
              ...(opts.kind === "card" ? ([["showCover", "Cover-Bild"]] as const) : []),
            ] as [keyof PrintOpts, string][]
          ).map(([k, l]) => (
            <label key={k} className="group-row">
              <span>{l}</span>
              <input type="checkbox" style={{ marginLeft: "auto" }} checked={Boolean(opts[k])} onChange={(e) => upd({ [k]: e.target.checked } as Partial<Opts>)} />
            </label>
          ))}
        </div>
        {perPage > 1 && (
          <label className="field">
            Schon benutzte Plätze auf dem ersten Blatt überspringen
            <input className="input" inputMode="numeric" value={opts.skip} onChange={(e) => upd({ skip: Math.max(0, Math.min(perPage - 1, Number(e.target.value) || 0)) })} />
          </label>
        )}
        <p className="tiny">
          Druckdialog: „Tatsächliche Größe / 100 %“, Kopf- und Fußzeilen aus{opts.kind !== "sticker" && ", Hintergrundgrafiken an"}. Für Einleger eignet sich mattes Papier mit 200 bis 300 g/m².
        </p>
      </div>

      <div className="print-area print-only">
        {pages.map((cells, pi) => (
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
            {cells.map((c, i) => (
              <div key={i} style={{ position: "relative", outline: tpl.cutMarks && c ? "0.1mm dashed rgba(0,0,0,.25)" : undefined, outlineOffset: "-0.05mm" }}>
                {c && render(c, i)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
