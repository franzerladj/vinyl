import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { api, canRecognize, discogs } from "../lib/api";
import { ocrImage } from "../lib/free";
import { addToCollection, addWant } from "../lib/sync";
import { toast, useStore } from "../lib/store";
import type { SearchResult } from "../lib/types";
import { Cover, Seg } from "../components/bits";
import { IconBack, IconCamera } from "../components/icons";

interface Recognition { artist: string; title: string; label: string; catno: string; barcode: string; year: string; matrix: string; confidence: string; notes: string; engine?: string; q?: string }

async function resizeImage(file: File, max = 1568): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

async function findCandidates(p: Partial<Recognition>): Promise<SearchResult[]> {
  const queries: string[] = [];
  const base = "type=release&per_page=15";
  if (p.barcode) queries.push(`barcode=${encodeURIComponent(p.barcode)}`);
  if (p.catno) queries.push(`catno=${encodeURIComponent(p.catno)}${p.label ? `&label=${encodeURIComponent(p.label)}` : ""}`);
  if (p.catno) queries.push(`catno=${encodeURIComponent(p.catno)}`);
  if (p.artist || p.title) queries.push(`artist=${encodeURIComponent(p.artist ?? "")}&release_title=${encodeURIComponent(p.title ?? "")}&format=Vinyl`);
  if (p.artist || p.title) queries.push(`q=${encodeURIComponent(`${p.artist ?? ""} ${p.title ?? ""}`.trim())}&format=Vinyl`);
  if (p.q) queries.push(`q=${encodeURIComponent(p.q)}`);
  const seen = new Set<number>();
  const out: SearchResult[] = [];
  for (const q of queries) {
    const r = await discogs<{ results: SearchResult[] }>(`/database/search?${base}&${q}`);
    for (const x of r.results) if (!seen.has(x.id)) (seen.add(x.id), out.push(x));
    if (out.length >= 10) break;
  }
  return out;
}

export default function Scan() {
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const serverAi = canRecognize(me);
  const [mode, setMode] = useState<"photo" | "barcode" | "manual">("photo");
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<Recognition | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [manual, setManual] = useState({ catno: "", artist: "", title: "", barcode: "" });
  const [preview, setPreview] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);

  const search = async (p: Partial<Recognition>) => {
    setBusy(true);
    try {
      setResults(await findCandidates(p));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Barcode-Scanner (funktioniert auch auf dem iPhone, da ZXing statt BarcodeDetector)
  useEffect(() => {
    if (mode !== "barcode" || results) return;
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    reader
      .decodeFromVideoDevice(undefined, video.current!, (res) => {
        if (res && !stopped) {
          stopped = true;
          controls.current?.stop();
          navigator.vibrate?.(80);
          const code = res.getText();
          setManual((m) => ({ ...m, barcode: code }));
          void search({ barcode: code });
        }
      })
      .then((c) => {
        controls.current = c;
        if (stopped) c.stop();
      })
      .catch((e) => toast(`Kamera: ${e.message}`));
    return () => {
      stopped = true;
      controls.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, results]);

  /** Texterkennung direkt auf dem Gerät (kostenlos, ohne Server) */
  const runOcr = async (dataUrl: string) => {
    setOcrProgress(0);
    try {
      const g = await ocrImage(dataUrl, setOcrProgress);
      const r: Recognition = { artist: "", title: "", label: "", catno: g.catno, barcode: g.barcode, year: "", matrix: "", confidence: "niedrig", notes: "Text auf dem Gerät gelesen.", engine: "ocr", q: g.query };
      setRec(r);
      setManual((m) => ({ ...m, catno: g.catno || m.catno, barcode: g.barcode || m.barcode }));
      setResults(await findCandidates(r));
    } finally {
      setOcrProgress(null);
    }
  };

  const onPhoto = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setResults(null);
    setRec(null);
    try {
      const b64 = await resizeImage(file);
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      setPreview(dataUrl);
      if (serverAi) {
        try {
          const r = await api<Recognition>("/api/ai/recognize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: b64, mediaType: "image/jpeg" }),
          });
          setRec(r);
          const found = await findCandidates(r);
          if (found.length) {
            setResults(found);
            return;
          }
        } catch (e) {
          console.warn("Server-Erkennung", e);
        }
      }
      await runOcr(dataUrl);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async (id: number) => {
    try {
      await addToCollection(id);
      toast("Zur Sammlung hinzugefügt. Sticker ist vorgemerkt.");
      nav(`/release/${id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Zurück">
          <IconBack />
        </button>
        <h1 style={{ fontSize: 20 }}>Platte hinzufügen</h1>
        <span className="spacer" />
      </div>
      <div className="page stack">
        <Seg
          value={mode}
          options={[
            ["photo", "Foto"],
            ["barcode", "Barcode"],
            ["manual", "Katalognr."],
          ]}
          onChange={(m) => {
            setMode(m);
            setResults(null);
            setRec(null);
          }}
        />

        {mode === "photo" && (
          <>
            <label className="card stack press" style={{ alignItems: "center", padding: 32, cursor: "pointer", textAlign: "center", border: "1.5px dashed var(--surface-3)", background: "transparent" }}>
              {preview ? <img src={preview} style={{ maxHeight: 220, borderRadius: 10 }} alt="" /> : <IconCamera />}
              <b>{ocrProgress != null ? `Lese Text … ${Math.round(ocrProgress * 100)} %` : busy ? "Erkenne Platte …" : "Cover, Label oder Runout fotografieren"}</b>
              <span className="sub">
                {serverAi ? "Die KI liest Artist, Titel, Label, Katalognummer und Barcode ab." : "Die App liest Katalognummer und Text direkt auf dem Handy. Am besten klappt das Center-Label oder die Rückseite."}
              </span>
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            </label>
            {rec && (
              <div className="card sub">
                {rec.engine === "ocr" ? "Gelesen" : `Erkannt (${rec.confidence})`}:{" "}
                <b style={{ color: "var(--text)" }}>{[rec.artist, rec.title].filter(Boolean).join(" – ") || rec.q || "kein Text"}</b>
                {rec.label && ` · ${rec.label}`} {rec.catno && ` · ${rec.catno}`} {rec.barcode && ` · ${rec.barcode}`}
                {rec.notes && <div style={{ marginTop: 4 }}>{rec.notes}</div>}
                {preview && rec.engine !== "ocr" && (
                  <button className="btn small ghost" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => runOcr(preview).catch((e) => toast(e.message))}>
                    Stattdessen Text auf dem Gerät lesen
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {mode === "barcode" && !results && (
          <div className="scan-wrap">
            <video ref={video} className="scan" muted playsInline />
            <div className="scan-frame" />
            <p className="sub" style={{ position: "absolute", left: 0, right: 0, bottom: 14, textAlign: "center", color: "#fff" }}>Barcode in den Rahmen halten</p>
          </div>
        )}

        {(mode === "manual" || (mode === "barcode" && results)) && (
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              void search(manual);
            }}
          >
            <div className="grid2">
              <input className="input" placeholder="Katalognummer" value={manual.catno} onChange={(e) => setManual({ ...manual, catno: e.target.value })} />
              <input className="input" placeholder="Barcode" value={manual.barcode} onChange={(e) => setManual({ ...manual, barcode: e.target.value })} />
              <input className="input" placeholder="Artist" value={manual.artist} onChange={(e) => setManual({ ...manual, artist: e.target.value })} />
              <input className="input" placeholder="Titel" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? "Suche …" : "Suchen"}
            </button>
            {mode === "barcode" && (
              <button type="button" className="btn ghost" onClick={() => setResults(null)}>
                Nochmal scannen
              </button>
            )}
          </form>
        )}

        {results && (
          <>
            <h2>{results.length ? "Welche Pressung ist es?" : "Nichts gefunden"}</h2>
            {results.length > 0 && <p className="sub" style={{ marginTop: -6 }}>Katalognummer und Land auf dem Label vergleichen.</p>}
            <div className="list">
              {results.map((r) => {
                const [artist, ...rest] = r.title.split(" - ");
                return (
                  <div key={r.id} className="rec">
                    <Cover src={r.thumb} />
                    <div className="rec-main" onClick={() => nav(`/release/${r.id}`)}>
                      <div className="rec-title">{rest.join(" - ")}</div>
                      <div className="rec-artist">{artist}</div>
                      <div className="rec-meta">
                        <span>{r.label?.[0]}</span>
                        <span>{r.catno}</span>
                        <span>{r.year}</span>
                        <span>{r.country}</span>
                        <span>{r.format?.join(", ")}</span>
                      </div>
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      <button className="btn small primary" onClick={() => add(r.id)}>
                        + Sammlung
                      </button>
                      <button className="btn small ghost" onClick={() => addWant(r.id).then(() => toast("Auf die Wantlist gesetzt"), (e) => toast(e.message))}>
                        ♡ Want
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
