import { NavBar } from "../components/ui";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { api, canRecognize, discogs } from "../lib/api";
import { ocrImage } from "../lib/free";
import { decodeBarcodeImage, startLiveScan, type LiveScan } from "../lib/barcode";
import { addToCollection, addWant, fetchMarketStats } from "../lib/sync";
import { money } from "../lib/format";
import { db } from "../lib/db";
import { toast, useStore } from "../lib/store";
import type { SearchResult } from "../lib/types";
import { Cover, Seg, haptic } from "../components/bits";
import { IconCamera } from "../components/icons";

interface Fields {
  artist: string;
  title: string;
  label: string;
  catno: string;
  barcode: string;
}
const EMPTY: Fields = { artist: "", title: "", label: "", catno: "", barcode: "" };

interface Recognition extends Partial<Fields> {
  confidence?: string;
  notes?: string;
  engine?: string;
}

async function loadImage(file: File, max = 1568) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return { bmp, b64: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

/** Katalognummern stehen auf Labels mal mit, mal ohne Leerzeichen oder Bindestrich */
export function catnoVariants(raw: string): string[] {
  const c = raw.trim().toUpperCase();
  if (!c) return [];
  const compact = c.replace(/[\s.-]+/g, "");
  const spaced = compact.replace(/^([A-Z]+)(\d)/, "$1 $2");
  const dashed = compact.replace(/^([A-Z]+)(\d)/, "$1-$2");
  return [...new Set([c, spaced, compact, dashed])];
}

async function findCandidates(p: Partial<Fields> & { q?: string }): Promise<SearchResult[]> {
  const enc = encodeURIComponent;
  const queries: string[] = [];
  if (p.barcode) queries.push(`barcode=${enc(p.barcode)}`);
  const cats = catnoVariants(p.catno ?? "");
  if (cats.length && p.label) queries.push(`catno=${enc(cats[0])}&label=${enc(p.label)}`);
  for (const c of cats) queries.push(`catno=${enc(c)}`);
  if (cats.length && p.artist) queries.push(`q=${enc(`${p.artist} ${cats[0]}`)}`);
  if (p.artist && p.title) queries.push(`artist=${enc(p.artist)}&release_title=${enc(p.title)}&format=Vinyl`);
  if (p.artist || p.title) queries.push(`q=${enc(`${p.artist ?? ""} ${p.title ?? ""}`.trim())}&format=Vinyl`);
  if (p.q) queries.push(`q=${enc(p.q)}`);
  const seen = new Set<number>();
  const out: SearchResult[] = [];
  for (const q of queries.slice(0, 7)) {
    const r = await discogs<{ results: SearchResult[] }>(`/database/search?type=release&per_page=15&${q}`);
    for (const x of r.results) if (!seen.has(x.id)) (seen.add(x.id), out.push(x));
    // Eindeutiger Treffer per Barcode oder Katalognummer: nicht weiter suchen
    if (out.length >= 10 || (out.length && (q.startsWith("barcode") || q.startsWith("catno")))) break;
  }
  return out;
}

export default function Scan() {
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const serverAi = canRecognize(me);
  const [mode, setMode] = useState<"scan" | "photo" | "manual">("scan");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<Recognition | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [preview, setPreview] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scan = useRef<LiveScan | null>(null);
  const owned = useLiveQuery(async () => new Set((await db.collection.toArray()).map((c) => c.releaseId)), []);
  const wanted = useLiveQuery(async () => new Set((await db.wants.toArray()).map((w) => w.releaseId)), []);

  const search = async (p: Partial<Fields> & { q?: string }) => {
    setBusy(true);
    setStatus("Suche bei Discogs …");
    try {
      setResults(await findCandidates(p));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const reset = (m = mode) => {
    setResults(null);
    setRec(null);
    setPreview(null);
    setFields(EMPTY);
    setMode(m);
  };

  // Live-Scanner
  useEffect(() => {
    if (mode !== "scan" || results || !video.current) return;
    let cancelled = false;
    setCamError(null);
    startLiveScan(video.current, (code) => {
      haptic(30);
      setFields({ ...EMPTY, barcode: code });
      setRec({ barcode: code, engine: "barcode" });
      void search({ barcode: code });
    })
      .then((s) => {
        if (cancelled) return s.stop();
        scan.current = s;
        setTorch(s.torch ? false : null);
      })
      .catch((e: Error) => setCamError(e.name === "NotAllowedError" ? "Kein Zugriff auf die Kamera. Bitte in den Einstellungen des Browsers erlauben." : `Kamera nicht verfügbar (${e.message}).`));
    return () => {
      cancelled = true;
      scan.current?.stop();
      scan.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, results]);

  const toggleTorch = async () => {
    if (!scan.current?.torch || torch == null) return;
    await scan.current.torch(!torch).catch(() => {});
    setTorch(!torch);
  };

  const onPhoto = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setResults(null);
    setRec(null);
    try {
      setStatus("Bild wird gelesen …");
      const { bmp, b64 } = await loadImage(file);
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      setPreview(dataUrl);
      // 1. Barcode im Foto? Das ist am zuverlässigsten
      const code = await decodeBarcodeImage(bmp);
      if (code) {
        haptic(30);
        setRec({ barcode: code, engine: "barcode" });
        setFields({ ...EMPTY, barcode: code });
        const found = await findCandidates({ barcode: code });
        if (found.length) return setResults(found);
      }
      // 2. Bildmodell auf dem Server
      let r: Recognition | null = null;
      if (serverAi) {
        setStatus("Cover wird erkannt …");
        try {
          r = await api<Recognition>("/api/ai/recognize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: b64, mediaType: "image/jpeg" }),
          });
        } catch (e) {
          console.warn("Server-Erkennung", e);
        }
      }
      // 3. Texterkennung auf dem Gerät, wenn die Bilderkennung nichts Brauchbares hat
      let q = "";
      if (!r || (!r.catno && !r.artist && !r.title)) {
        setStatus("Lese Text auf dem Gerät …");
        const g = await ocrImage(dataUrl, (p) => setStatus(`Lese Text … ${Math.round(p * 100)} %`));
        r = { ...r, catno: r?.catno || g.catno, barcode: r?.barcode || g.barcode, engine: "ocr", notes: "Text auf dem Gerät gelesen." };
        q = g.query;
      }
      const f: Fields = { artist: r.artist ?? "", title: r.title ?? "", label: r.label ?? "", catno: r.catno ?? "", barcode: code || r.barcode || "" };
      setRec(r);
      setFields(f);
      await search({ ...f, q });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const add = async (id: number) => {
    try {
      await addToCollection(id);
      haptic(20);
      toast("Zur Sammlung hinzugefügt. Einleger ist vorgemerkt.");
      nav(`/release/${id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const showForm = mode === "manual" || rec || (results && mode !== "photo");
  const field = (k: keyof Fields, ph: string, mode?: "numeric") => (
    <input className="input" placeholder={ph} inputMode={mode} value={fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
  );

  return (
    <>
      <NavBar title="Platte hinzufügen" />
      <div className="page stack">
        <Seg
          value={mode}
          options={[
            ["scan", "Barcode"],
            ["photo", "Foto"],
            ["manual", "Eingeben"],
          ]}
          onChange={(m) => reset(m)}
        />

        {mode === "scan" && !results && (
          <>
            <div className="scan-wrap">
              <video ref={video} className="scan" muted playsInline autoPlay />
              <div className="scan-frame" />
              {torch != null && (
                <button className={`scan-torch${torch ? " on" : ""}`} onClick={toggleTorch} aria-label="Licht">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2h8l-1 6H9zM9 8l1 14h4l1-14" />
                  </svg>
                </button>
              )}
              <p className="scan-hint">{busy ? status : camError ?? "Barcode auf der Rückseite in den Rahmen halten"}</p>
            </div>
            <p className="sub" style={{ textAlign: "center" }}>
              Kein Barcode drauf? Ältere Platten haben meist keinen.{" "}
              <button className="link" onClick={() => reset("photo")}>
                Label fotografieren
              </button>{" "}
              oder{" "}
              <button className="link" onClick={() => reset("manual")}>
                Katalognummer eingeben
              </button>
              .
            </p>
          </>
        )}

        {mode === "photo" && (
          <label className="card stack press" style={{ alignItems: "center", padding: 28, cursor: "pointer", textAlign: "center", border: "1.5px dashed var(--surface-3)", background: "transparent" }}>
            {preview ? (
              <img src={preview} style={{ maxHeight: 200, borderRadius: 10 }} alt="" />
            ) : (
              <span style={{ width: 64, height: 64, borderRadius: 20, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
                <span style={{ width: 32, height: 32, display: "grid" }}>
                  <IconCamera />
                </span>
              </span>
            )}
            <b>{busy ? status || "Erkenne Platte …" : preview ? "Anderes Foto" : "Rückseite, Center-Label oder Cover"}</b>
            <span className="sub">
              Am besten klappt die Rückseite mit Barcode oder das Center-Label mit Katalognummer, gerade von oben und ohne Spiegelung.
              {serverAi ? " Klappt auch bei Covern ohne Text." : ""}
            </span>
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
        )}

        {showForm && (
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              void search(fields);
            }}
          >
            {rec && (
              <div className="sub">
                {rec.engine === "barcode" ? "Barcode gelesen" : rec.engine === "ocr" ? "Text gelesen" : "Am Cover erkannt"}. Felder bei Bedarf korrigieren.
              </div>
            )}
            <div className="grid2">
              {field("catno", "Katalognummer")}
              {field("barcode", "Barcode", "numeric")}
              {field("artist", "Artist")}
              {field("title", "Titel")}
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? "Suche …" : results ? "Neu suchen" : "Suchen"}
            </button>
            {mode === "scan" && results && (
              <button type="button" className="btn ghost" onClick={() => reset("scan")}>
                Nächste Platte scannen
              </button>
            )}
          </form>
        )}

        {results && results.length > 0 && owned && wanted && <Verdict results={results} owned={owned} wanted={wanted} />}
        {results && (
          <>
            <h2>{results.length ? (results.length === 1 ? "Gefunden" : "Welche Pressung ist es?") : "Nichts gefunden"}</h2>
            <p className="sub" style={{ marginTop: -6 }}>
              {results.length ? "Katalognummer und Land auf dem Label vergleichen." : "Katalognummer vom Label probieren, die steht fast immer drauf (z. B. „WARP 12“)."}
            </p>
            <div className="list">
              {results.map((r) => {
                const [artist, ...rest] = r.title.split(" - ");
                const have = owned?.has(r.id);
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
                      </div>
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      {have ? (
                        <span className="badge">in Sammlung</span>
                      ) : (
                        <button className="btn small primary" onClick={() => add(r.id)}>
                          + Sammlung
                        </button>
                      )}
                      {!have && !wanted?.has(r.id) && (
                        <button className="btn small ghost" onClick={() => addWant(r.id).then(() => toast("Auf die Wantlist gesetzt"), (e) => toast(e.message))}>
                          ♡ Want
                        </button>
                      )}
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

/** Plattenbörse: auf einen Blick, ob man die Platte schon hat, sucht oder was sie kostet */
function Verdict({ results, owned, wanted }: { results: SearchResult[]; owned: Set<number>; wanted: Set<number> }) {
  const ownedMasters = useLiveQuery(async () => {
    const rels = await db.releases.bulkGet([...owned]);
    return new Map(rels.filter((r) => r?.masterId).map((r) => [r!.masterId!, r!]));
  }, [owned]);
  const exact = results.find((r) => owned.has(r.id));
  const want = results.find((r) => wanted.has(r.id));
  const sibling = !exact ? results.find((r) => r.master_id && ownedMasters?.has(r.master_id)) : undefined;
  const top = exact ?? want ?? results[0];
  const kind = exact ? "have" : want ? "want" : sibling ? "other" : "new";
  useEffect(() => {
    fetchMarketStats([top.id]).catch(() => undefined);
    haptic(kind === "have" ? 20 : 10);
  }, [top.id, kind]);
  const stat = useLiveQuery(() => db.marketStats.get(top.id), [top.id]);
  const target = useLiveQuery(async () => (await db.wantMeta.get(top.id))?.targetPrice ?? null, [top.id]);
  const label = { have: "Hast du schon", want: "Auf deiner Wantlist", other: "Andere Pressung in deiner Kiste", new: "Neu für dich" }[kind];
  const text =
    kind === "have"
      ? results.length > 1 && exact !== results[0]
        ? "Eine der gefundenen Pressungen steht in deiner Sammlung."
        : "Genau diese Pressung steht in deiner Sammlung."
      : kind === "want"
        ? target
          ? `Dein Wunschpreis: ${money(target, stat?.currency)}`
          : "Die suchst du. Preis vergleichen und zuschlagen."
        : kind === "other"
          ? `Du hast „${ownedMasters!.get(sibling!.master_id!)!.title}“ in einer anderen Pressung. Katalognummer vergleichen.`
          : top.community
            ? `${top.community.want} wollen sie, ${top.community.have} haben sie.`
            : "Noch nicht in deiner Sammlung oder Wantlist.";
  return (
    <div className={`verdict ${kind}`} role="status" aria-live="polite">
      <span className="verdict-label">{label}</span>
      <span className="verdict-text">{text}</span>
      <span className="verdict-price mono">
        {stat === undefined ? "Preis wird geladen …" : stat?.lowest != null ? `Discogs ab ${money(stat.lowest, stat.currency)} · ${stat.numForSale} Angebote` : "Gerade kein Angebot auf Discogs"}
      </span>
    </div>
  );
}
