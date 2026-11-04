import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, getKV, setKV } from "../lib/db";
import { canClaude, logout, ownAnthropicKey, setOwnAnthropicKey } from "../lib/api";
import { getSheetsConfig, pullTracksFromSheets, pushToSheets, type SheetsConfig } from "../lib/sheets";
import { autoPipeline, fetchMissingDetails, getAutoSettings, lookupAudioFor, tagVibes, type AutoSettings } from "../lib/sync";
import { suggestionsState } from "../lib/prices";
import { toast, useStore } from "../lib/store";
import { IconBack } from "../components/icons";

const TABLES = ["releases", "collection", "wants", "tracks", "recordMeta", "sets", "marketStats", "listings", "kv"] as const;

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

export default function Settings() {
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const jobs = useStore((s) => s.jobs);
  const [sheets, setSheets] = useState<SheetsConfig>({ url: "", secret: "" });
  const [currency, setCurrency] = useState("EUR");
  const [analyzeAudio, setAnalyzeAudio] = useState(true);
  const [ownKey, setOwnKey] = useState(ownAnthropicKey());
  const [auto, setAuto] = useState<AutoSettings>({ analyze: true, audio: true });
  const [sugg, setSugg] = useState<string>("unknown");
  useEffect(() => {
    getAutoSettings().then(setAuto);
    suggestionsState().then(setSugg);
  }, []);
  const saveAuto = (a: AutoSettings) => {
    setAuto(a);
    void setKV("auto", a);
  };

  useEffect(() => {
    getSheetsConfig().then(setSheets);
    getKV("currency", "EUR").then(setCurrency);
  }, []);

  const run = (label: string, fn: () => Promise<unknown>) => () =>
    fn().then(
      (r) => toast(typeof r === "string" ? r : `${label}: fertig`),
      (e) => toast(`${label}: ${(e as Error).message}`),
    );

  const exportBackup = async () => {
    const out: Record<string, unknown[]> = {};
    for (const t of TABLES) out[t] = await db.table(t).toArray();
    download(`crate-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data: out })], { type: "application/json" }));
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    const json = JSON.parse(await file.text()) as { data: Record<string, unknown[]> };
    await db.transaction("rw", TABLES.map((t) => db.table(t)), async () => {
      for (const t of TABLES) if (json.data[t]) await db.table(t).bulkPut(json.data[t]);
    });
    toast("Backup eingespielt");
  };

  const exportCsv = async () => {
    const [tracks, rels] = await Promise.all([db.tracks.toArray(), db.releases.toArray()]);
    const rm = new Map(rels.map((r) => [r.id, r]));
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Artist", "Track", "Release", "Label", "Katalognr.", "Pos.", "BPM", "Key", "Energie", "Vibes", "Sterne"]].concat(
      tracks.map((t) => {
        const r = rm.get(t.releaseId);
        return [t.artist, t.title, r?.title ?? "", r?.labels[0]?.name ?? "", r?.labels[0]?.catno ?? "", t.position, String(t.bpm ?? ""), t.key ?? "", String(t.energy ?? ""), (t.moods ?? []).join(", "), String(t.stars ?? "")];
      }),
    );
    download("crate-tracks.csv", new Blob(["﻿" + rows.map((r) => r.map(esc).join(";")).join("\n")], { type: "text/csv" }));
  };

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Zurück">
          <IconBack />
        </button>
        <h1 style={{ fontSize: 20 }}>Einstellungen</h1>
        <span className="spacer" />
      </div>
      <div className="page stack">
        <div className="card row">
          <div>
            <div className="sub">Angemeldet bei Discogs als</div>
            <b>{me?.username}</b>
          </div>
          <span className="spacer" />
          {!me?.personalToken && (
            <button
              className="btn small ghost"
              onClick={async () => {
                await logout();
                location.href = "/";
              }}
            >
              Abmelden
            </button>
          )}
        </div>

        <h2>Daten ergänzen</h2>
        <div className="card stack">
          <button className="btn primary" disabled={Object.keys(jobs).length > 0} onClick={run("Sync", async () => (await autoPipeline({ force: true }), "Alles synchron und analysiert"))}>
            Alles synchronisieren & analysieren
          </button>
          <label className="row sub">
            <input type="checkbox" checked={auto.analyze} onChange={(e) => saveAuto({ ...auto, analyze: e.target.checked })} /> Nach jedem Sync automatisch BPM, Key, Vibes und Preise ergänzen
          </label>
          <label className="row sub">
            <input type="checkbox" checked={auto.audio} onChange={(e) => saveAuto({ ...auto, audio: e.target.checked })} /> Dabei Hörproben analysieren (ca. 0,5 MB pro Track, am besten im WLAN)
          </label>
          {sugg === "needs-seller-settings" && (
            <div className="card" style={{ background: "var(--accent-soft)" }}>
              <b>Tipp für genauere Preise</b>
              <div className="sub">
                Discogs gibt Preisempfehlungen aus echten Verkäufen nur heraus, wenn deine Verkäufer-Einstellungen ausgefüllt sind (kostenlos, du musst nichts verkaufen).{" "}
                <a href="https://www.discogs.com/settings/seller" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  Zu den Einstellungen ↗
                </a>
              </div>
            </div>
          )}
          <div className="tiny" style={{ marginTop: 6 }}>Einzelne Schritte:</div>
          <button className="btn" onClick={run("Tracklists", () => fetchMissingDetails("collection"))}>
            Fehlende Tracklists laden
          </button>
          <button className="btn" disabled={!!jobs.audio} onClick={run("BPM/Key", async () => `${await lookupAudioFor()} Tracks mit BPM/Key ergänzt`)}>
            BPM & Key aus Datenbanken
          </button>
          <button
            className="btn"
            disabled={!!jobs["free-vibes"]}
            onClick={run("Vibes", async () => {
              const { enrichFree } = await import("../lib/free");
              return `${await enrichFree(undefined, { audio: analyzeAudio })} Tracks ergänzt`;
            })}
          >
            Vibes & Energie ergänzen (gratis)
          </button>
          <label className="row sub">
            <input type="checkbox" checked={analyzeAudio} onChange={(e) => setAnalyzeAudio(e.target.checked)} /> Hörproben analysieren (Energie, fehlende BPM und Keys, ca. 0,5 MB pro Track, besser im WLAN)
          </label>
          {canClaude(me) && (
            <button className="btn" disabled={!!jobs.vibes} onClick={run("Vibes", async () => `${await tagVibes()} Tracks mit Claude getaggt`)}>
              Genauer mit Claude taggen
            </button>
          )}
        </div>

        <h2>Datenquellen</h2>
        <div className="group">
          {(
            [
              ["Discogs", true, "Sammlung, Wantlist, Tracklists, Preise"],
              ["Deezer", true, "BPM und Hörproben"],
              ["Audio-Analyse", true, "Energie, Tempo und Tonart aus der Hörprobe, auf dem Gerät"],
              ["Texterkennung", true, "Katalognummer vom Foto lesen, auf dem Gerät"],
              ["Last.fm", me?.features.lastfm, "Vibe-Tags von Hörern"],
              ["GetSongBPM", me?.features.keyLookup, "BPM und Tonart"],
              ["Workers AI", me?.features.freeAi, "Fotos erkennen, kostenloses Kontingent"],
              ["Claude", canClaude(me), "Beste Erkennung und Vibes, optional"],
            ] as [string, boolean | undefined, string][]
          ).map(([n, on, d]) => (
            <div key={n} className="group-row">
              <span className="dot" style={{ background: on ? "var(--ok)" : "var(--surface-3)" }} />
              <div>
                <div style={{ fontWeight: 600 }}>{n}</div>
                <div className="tiny">{d}</div>
              </div>
              <span className="chev sub">{on ? "aktiv" : "aus"}</span>
            </div>
          ))}
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          Eigener Anthropic-Key (optional, bleibt auf diesem Gerät)
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={ownKey}
            onChange={(e) => setOwnKey(e.target.value.trim())}
            onBlur={() => {
              setOwnAnthropicKey(ownKey);
              if (ownKey) toast("Key gespeichert");
            }}
          />
        </label>
        <p className="tiny">Mit eigenem Key nutzt du Claude für Fotos und Vibes auf deine Kosten. Der Key geht nur zur Anfrage durch den Server und wird dort nicht gespeichert.</p>

        <h2>Google Sheets</h2>
        <div className="card stack">
          <span className="sub">
            Spiegelt Sammlung, Wantlist, Tracks und Sets in dein eigenes Google Sheet. Änderungen an BPM, Key, Energie, Vibes, Sternen und Notizen im Blatt „Tracks“ kannst du zurückholen. Einrichtung: siehe google-sheets/README.md im Repo.
          </span>
          <label className="field">
            Apps-Script-URL (Web-App)
            <input className="input" value={sheets.url} onChange={(e) => setSheets({ ...sheets, url: e.target.value.trim() })} placeholder="https://script.google.com/macros/s/…/exec" />
          </label>
          <label className="field">
            Geheimwort (wie im Script)
            <input className="input" value={sheets.secret} onChange={(e) => setSheets({ ...sheets, secret: e.target.value })} />
          </label>
          <div className="grid2">
            <button
              className="btn primary"
              onClick={run("Sheets", async () => {
                await setKV("sheets", sheets);
                const n = await pushToSheets();
                return `An Sheets gesendet: ${n.Collection} Platten, ${n.Tracks} Tracks`;
              })}
            >
              → In Sheets schreiben
            </button>
            <button
              className="btn"
              onClick={run("Sheets", async () => {
                await setKV("sheets", sheets);
                return `${await pullTracksFromSheets()} Tracks aus Sheets übernommen`;
              })}
            >
              ← Tracks zurückholen
            </button>
          </div>
        </div>

        <h2>Allgemein</h2>
        <div className="card stack">
          <label className="field">
            Währung für Preise
            <select
              className="input"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                void setKV("currency", e.target.value);
              }}
            >
              {["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "AUD", "CAD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <h2>Backup & Export</h2>
        <div className="card stack">
          <span className="sub">Deine eigenen Daten (BPM, Keys, Sets, Regalplätze) liegen auf diesem Gerät. Regelmäßig sichern oder nach Sheets spiegeln.</span>
          <div className="grid2">
            <button className="btn" onClick={exportBackup}>
              Backup herunterladen
            </button>
            <label className="btn">
              Backup einspielen
              <input type="file" accept="application/json" hidden onChange={(e) => importBackup(e.target.files?.[0]).catch((err) => toast(err.message))} />
            </label>
          </div>
          <button className="btn" onClick={exportCsv}>
            Tracks als CSV (Excel)
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              if (!confirm("Lokalen Cache löschen? Eigene Daten (BPM, Sets …) gehen verloren, wenn kein Backup existiert.")) return;
              await db.delete();
              location.reload();
            }}
          >
            Lokale Daten löschen
          </button>
        </div>
      </div>
    </>
  );
}
