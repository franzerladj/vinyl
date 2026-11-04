// Einstellungen im iOS-Stil: Übersicht mit Gruppen, Unterseiten pro Bereich.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV } from "../lib/db";
import { canClaude, logout, ownAnthropicKey, setOwnAnthropicKey } from "../lib/api";
import { getSheetsConfig, pullTracksFromSheets, pushToSheets, type SheetsConfig } from "../lib/sheets";
import { autoPipeline, fetchMissingDetails, getAutoSettings, lookupAudioFor, tagVibes, type AutoSettings } from "../lib/sync";
import { suggestionsState } from "../lib/prices";
import { toast, useStore } from "../lib/store";
import { getTheme, hapticsEnabled, setHaptics, setTheme, type Theme } from "../lib/theme";
import { Avatar, Seg } from "../components/bits";
import type { MyProfile } from "../lib/friends";
import { NavBar, Switch } from "../components/ui";
import {
  IconBolt,
  IconChevron,
  IconCoin,
  IconDatabase,
  IconDownload,
  IconHelp,
  IconInfo,
  IconSheet,
  IconSparkle,
  IconSun,
  IconSync,
  IconWave,
  IconUser,
  IconShare,
} from "../components/icons";

const TABLES = ["releases", "collection", "wants", "tracks", "recordMeta", "sets", "marketStats", "listings", "kv", "priceHistory", "priceSuggestions", "wantMeta", "sellers", "friends", "friendItems"] as const;

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

const run = (label: string, fn: () => Promise<unknown>) => () =>
  fn().then(
    (r) => toast(typeof r === "string" ? r : `${label}: fertig`),
    (e) => toast(`${label}: ${(e as Error).message}`),
  );

const when = (ts?: number | null) => (ts ? new Date(ts).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "noch nie");

/** Eine Zeile in einer Einstellungsgruppe */
function Row({ icon, color, label, sub, value, to, onClick, right, danger }: { icon?: React.ReactNode; color?: string; label: React.ReactNode; sub?: React.ReactNode; value?: React.ReactNode; to?: string; onClick?: () => void; right?: React.ReactNode; danger?: boolean }) {
  const inner = (
    <>
      {icon && (
        <span className="ico" style={{ background: color }}>
          {icon}
        </span>
      )}
      <span className="label">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      {value != null && <span className="value">{value}</span>}
      {right}
      {(to || (onClick && !right)) && !danger && (
        <span className="chev">
          <IconChevron />
        </span>
      )}
    </>
  );
  if (to)
    return (
      <Link to={to} viewTransition className="set-row press">
        {inner}
      </Link>
    );
  return (
    <button className={`set-row ${danger ? "danger" : ""}`} onClick={onClick} type="button">
      {inner}
    </button>
  );
}

function Group({ title, foot, children }: { title?: string; foot?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="settings-group">
      {title && <div className="eyebrow">{title}</div>}
      <div className="group">{children}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export default function Settings() {
  const { section } = useParams();
  switch (section) {
    case "sync":
      return <SyncPage />;
    case "prices":
      return <PricesPage />;
    case "sources":
      return <SourcesPage />;
    case "sheets":
      return <SheetsPage />;
    case "data":
      return <DataPage />;
    case "about":
      return <AboutPage />;
    case "help":
      return <HelpPage />;
    default:
      return <Overview />;
  }
}

function Overview() {
  const me = useStore((s) => s.me);
  const [theme, setT] = useState<Theme>(getTheme());
  const [haptics, setH] = useState(hapticsEnabled());
  const profile = useLiveQuery(() => getKV<MyProfile | null>("myProfile", null));
  const stats = useLiveQuery(async () => ({
    friends: await db.friends.count(),
    lent: (await db.recordMeta.toArray()).filter((m) => m.lentTo).length,
    records: await db.collection.count(),
    wants: await db.wants.count(),
    lastSync: await getKV<number>("lastCollectionSync", 0),
    currency: await getKV("currency", "EUR"),
    sheets: (await getSheetsConfig()).url,
    favorites: (await db.sellers.toArray()).filter((s) => s.favorite).length,
  }));
  const sources = [me?.features.lastfm, me?.features.freeAi, me?.features.keyLookup, canClaude(me)].filter(Boolean).length + 3;

  return (
    <>
      <NavBar title="Einstellungen" backTo="/" backLabel="Start" />
      <div className="page settings-list">
        <div className="group">
          <div className="profile-card">
            <Avatar src={profile?.avatar} name={me?.username ?? "?"} size={58} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 19 }}>{profile?.name || me?.username}</b>
              {profile?.name && <div className="sub">{me?.username}{profile.location ? ` · ${profile.location}` : ""}</div>}
              <div className="sub">
                Discogs verbunden · {stats?.records ?? "–"} Platten · {stats?.wants ?? "–"} Wants
              </div>
            </div>
          </div>
          <Row label="Profil auf Discogs" value="↗" onClick={() => window.open(`https://www.discogs.com/user/${me?.username}`, "_blank")} right={<span />} />
        </div>

        <Group title="Bibliothek">
          <Row icon={<IconSync />} color="#30d158" label="Synchronisation & Analyse" value={stats?.lastSync ? new Date(stats.lastSync).toLocaleDateString("de-DE") : "nie"} to="/settings/sync" />
          <Row icon={<IconCoin />} color="#ff9f0a" label="Preise & Shopping" value={stats?.currency} to="/settings/prices" />
          <Row icon={<IconWave />} color="#5e5ce6" label="Datenquellen & KI" value={`${sources} aktiv`} to="/settings/sources" />
        </Group>

        <Group title="Freunde">
          <Row icon={<IconUser />} color="#bf5af2" label="Freunde" value={stats?.friends ?? 0} to="/friends" />
          <Row icon={<IconShare />} color="#ff9f0a" label="Verliehene Platten" value={stats?.lent ?? 0} to="/friends?tab=lent" />
        </Group>

        <Group title="Darstellung" foot="„System“ folgt der Einstellung deines Handys.">
          <div className="set-row" style={{ cursor: "default" }}>
            <span className="ico" style={{ background: "#0a84ff" }}>
              <IconSun />
            </span>
            <span className="label">Erscheinungsbild</span>
          </div>
          <div style={{ padding: "0 14px 12px" }}>
            <Seg
              value={theme}
              options={[
                ["system", "System"],
                ["light", "Hell"],
                ["dark", "Dunkel"],
              ]}
              onChange={(t) => {
                setT(t);
                setTheme(t);
              }}
            />
          </div>
          <Row
            icon={<IconBolt />}
            color="#ff375f"
            label="Haptisches Feedback"
            sub="Kurzes Vibrieren bei Aktionen (Android)"
            right={
              <Switch
                checked={haptics}
                label="Haptisches Feedback"
                onChange={(v) => {
                  setH(v);
                  setHaptics(v);
                }}
              />
            }
          />
        </Group>

        <Group title="Daten">
          <Row icon={<IconSheet />} color="#34c759" label="Google Sheets" value={stats?.sheets ? "verbunden" : "aus"} to="/settings/sheets" />
          <Row icon={<IconDatabase />} color="#8e8e93" label="Speicher & Backup" to="/settings/data" />
        </Group>

        <Group title="Info">
          <Row icon={<IconHelp />} color="#ff9f0a" label="Tipps & Hilfe" to="/settings/help" />
          <Row icon={<IconInfo />} color="#64d2ff" label="Über Crate" value={`v${__APP_VERSION__}`} to="/settings/about" />
        </Group>

        {!me?.personalToken && (
          <div className="group">
            <Row
              label="Abmelden"
              danger
              onClick={async () => {
                if (!confirm("Von Discogs abmelden? Deine lokalen Daten bleiben auf diesem Gerät.")) return;
                await logout();
                try {
                  localStorage.removeItem("crate_me");
                } catch {
                  /* egal */
                }
                location.href = "/";
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

function SyncPage() {
  const jobs = useStore((s) => s.jobs);
  const me = useStore((s) => s.me);
  const [auto, setAuto] = useState<AutoSettings>({ analyze: true, audio: true });
  const info = useLiveQuery(async () => {
    const [coll, wants, tracks, rels, stats] = await Promise.all([db.collection.toArray(), db.wants.toCollection().primaryKeys(), db.tracks.toArray(), db.releases.toArray(), db.marketStats.toArray()]);
    const mine = new Set(coll.map((c) => c.releaseId));
    const myTracks = tracks.filter((t) => mine.has(t.releaseId));
    const relMap = new Map(rels.map((r) => [r.id, r]));
    const statIds = new Set(stats.map((x) => x.releaseId));
    return {
      lastSync: await getKV<number>("lastCollectionSync", 0),
      lastAuto: await getKV<number>("lastAutoRun", 0),
      log: await getKV<{ at: number; step: string; message: string }[]>("syncLog", []),
      records: mine.size,
      withDetail: [...mine].filter((id) => relMap.get(id)?.detailFetchedAt).length,
      tracks: myTracks.length,
      lookedUp: myTracks.filter((t) => t.lookedUpAt).length,
      analyzed: myTracks.filter((t) => t.analyzedAt).length,
      vibes: myTracks.filter((t) => t.energy != null).length,
      withBpm: myTracks.filter((t) => t.bpm).length,
      withKey: myTracks.filter((t) => t.key).length,
      wants: wants.length,
      priced: wants.filter((id) => statIds.has(id)).length,
    };
  });
  useEffect(() => {
    getAutoSettings().then(setAuto);
  }, []);
  const save = (a: AutoSettings) => {
    setAuto(a);
    void setKV("auto", a);
  };
  const busy = Object.keys(jobs).length > 0;

  return (
    <>
      <NavBar title="Synchronisation" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <div>
          <button className="btn primary block lg" disabled={busy} onClick={run("Sync", async () => (await autoPipeline({ force: true }), "Alles synchron und analysiert"))}>
            {busy ? "Läuft gerade …" : "Jetzt synchronisieren & analysieren"}
          </button>
          <p className="tiny" style={{ textAlign: "center" }}>
            Zuletzt: {when(info?.lastSync)}
          </p>
        </div>

        <Group title="Automatisch" foot="Nach jedem Sync ergänzt die App fehlende Tracklists, BPM, Keys, Vibes und Preise. Deine Aktionen haben dabei immer Vorrang.">
          <Row label="Nach dem Sync analysieren" right={<Switch checked={auto.analyze} label="Nach dem Sync analysieren" onChange={(v) => save({ ...auto, analyze: v })} />} />
          <Row label="Hörproben analysieren" sub="Energie, fehlende BPM und Keys · ca. 0,5 MB pro Track" right={<Switch checked={auto.audio} label="Hörproben analysieren" onChange={(v) => save({ ...auto, audio: v })} />} />
        </Group>

        <Group title="Fortschritt" foot="Jeder Schritt arbeitet nur ab, was noch fehlt. Wird die App unterbrochen, geht es beim nächsten Öffnen automatisch weiter.">
          {info &&
            (
              [
                ["Tracklists", info.withDetail, info.records],
                ["BPM & Key gesucht", info.lookedUp, info.tracks],
                ["Hörproben analysiert", info.analyzed, info.tracks],
                ["Vibes & Energie", info.vibes, info.tracks],
                ["Preise der Wants", info.priced, info.wants],
              ] as [string, number, number][]
            ).map(([l, a, b]) => (
              <div key={l} className="set-row" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div className="row">
                  <span className="label">{l}</span>
                  <span className="value">
                    {a} / {b}
                  </span>
                </div>
                <div className="progress" style={{ height: 4 }}>
                  <div style={{ width: `${b ? (100 * a) / b : 0}%`, background: a >= b ? "var(--ok)" : undefined }} />
                </div>
              </div>
            ))}
        </Group>

        <Group title="Ergebnis">
          <Row label="Tracks mit BPM" value={info ? `${info.withBpm} von ${info.tracks}` : "–"} />
          <Row label="Tracks mit Key" value={info ? `${info.withKey} von ${info.tracks}` : "–"} />
          <Row label="Letzter kompletter Durchlauf" value={info?.lastAuto ? new Date(info.lastAuto).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie"} />
        </Group>

        {info && info.log.length > 0 && (
          <Group title="Letzte Probleme" foot="Hilft bei der Fehlersuche. Einzelne Fehler sind normal, z.B. wenn das Netz kurz weg war.">
            {info.log.slice(0, 8).map((e, i) => (
              <div key={i} className="set-row" style={{ cursor: "default" }}>
                <span className="label">
                  {e.step}
                  <small>{e.message}</small>
                </span>
                <span className="value" style={{ fontSize: 12 }}>
                  {new Date(e.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
            <Row label="Protokoll leeren" danger onClick={() => setKV("syncLog", [])} />
          </Group>
        )}

        <Group title="Einzelne Schritte">
          <Row icon={<IconDownload />} color="#0a84ff" label="Fehlende Tracklists laden" onClick={run("Tracklists", () => fetchMissingDetails("collection"))} />
          <Row icon={<IconWave />} color="#5e5ce6" label="BPM & Key aus Datenbanken" onClick={run("BPM/Key", async () => `${await lookupAudioFor()} Tracks ergänzt`)} />
          <Row
            icon={<IconSparkle />}
            color="#ff9f0a"
            label={canClaude(me) ? "Vibes mit Claude taggen" : "Vibes & Energie ergänzen"}
            onClick={run("Vibes", async () => `${await tagVibes(undefined, { audio: auto.audio })} Tracks ergänzt`)}
          />
        </Group>
      </div>
    </>
  );
}

const SHOP_DEFAULTS = { firstItem: 7, perExtraItem: 1.5, maxPrice: "", minRating: "98", minCondition: "VG+", maxSellers: "" };

function PricesPage() {
  const [currency, setCurrency] = useState("EUR");
  const [shop, setShop] = useState(SHOP_DEFAULTS);
  const [sugg, setSugg] = useState("unknown");
  const favorites = useLiveQuery(async () => (await db.sellers.toArray()).filter((s) => s.favorite).length, [], 0);
  useEffect(() => {
    getKV("currency", "EUR").then(setCurrency);
    getKV("shopSettings", SHOP_DEFAULTS).then((s) => setShop({ ...SHOP_DEFAULTS, ...s }));
    suggestionsState().then(setSugg);
  }, []);
  const saveShop = (p: Partial<typeof SHOP_DEFAULTS>) => {
    const s = { ...shop, ...p };
    setShop(s);
    void setKV("shopSettings", s);
  };
  return (
    <>
      <NavBar title="Preise & Shopping" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <Group title="Währung" foot="Gilt für Marktpreise und Preisempfehlungen. Bereits geladene Preise werden beim nächsten Update umgerechnet.">
          <div className="set-row" style={{ cursor: "default" }}>
            <span className="label">Währung</span>
            <select
              className="input"
              style={{ width: 120 }}
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                void setKV("currency", e.target.value);
                void db.marketStats.clear();
              }}
            >
              {["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "AUD", "CAD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Group>

        <Group title="Preisempfehlungen">
          <Row
            label="Discogs-Preisempfehlung"
            sub={sugg === "ok" ? "aktiv, aus echten Verkäufen" : sugg === "needs-seller-settings" ? "braucht ausgefüllte Verkäufer-Einstellungen" : "wird beim nächsten Preis-Update geprüft"}
            value={sugg === "ok" ? "an" : "aus"}
          />
          {sugg !== "ok" && <Row label="Verkäufer-Einstellungen öffnen" sub="Kostenlos, du musst nichts verkaufen" value="↗" right={<span />} onClick={() => window.open("https://www.discogs.com/settings/seller", "_blank")} />}
        </Group>

        <Group title="Versand-Schätzung" foot="Wird genutzt, wenn ein Angebot keinen Versand nennt. Die echten Kosten zeigt Discogs im Warenkorb.">
          <div className="set-row" style={{ cursor: "default" }}>
            <span className="label">Erste Platte</span>
            <input className="input" style={{ width: 90, textAlign: "right" }} inputMode="decimal" value={shop.firstItem} onChange={(e) => saveShop({ firstItem: Number(e.target.value.replace(",", ".")) || 0 })} />
            <span className="sub">€</span>
          </div>
          <div className="set-row" style={{ cursor: "default" }}>
            <span className="label">Jede weitere</span>
            <input className="input" style={{ width: 90, textAlign: "right" }} inputMode="decimal" value={shop.perExtraItem} onChange={(e) => saveShop({ perExtraItem: Number(e.target.value.replace(",", ".")) || 0 })} />
            <span className="sub">€</span>
          </div>
        </Group>

        <Group title="Händler">
          <Row label="Lieblingshändler" value={favorites} to="/shop" />
          <Row label="Mindestbewertung" right={<select className="input" style={{ width: 110 }} value={shop.minRating} onChange={(e) => saveShop({ minRating: e.target.value })}>{["", "95", "97", "98", "99", "99.5"].map((v) => <option key={v} value={v}>{v ? `${v} %` : "egal"}</option>)}</select>} />
          <Row label="Mindestzustand" right={<select className="input" style={{ width: 110 }} value={shop.minCondition} onChange={(e) => saveShop({ minCondition: e.target.value })}>{["", "M", "NM", "VG+", "VG", "G+"].map((v) => <option key={v} value={v}>{v || "egal"}</option>)}</select>} />
        </Group>
      </div>
    </>
  );
}

function SourcesPage() {
  const me = useStore((s) => s.me);
  const [ownKey, setOwnKey] = useState(ownAnthropicKey());
  const list: [string, boolean | undefined, string][] = [
    ["Discogs", true, "Sammlung, Wantlist, Tracklists, Preise"],
    ["Deezer", true, "BPM und Hörproben, passender Mix nach Titel und Länge"],
    ["YouTube", true, "Videos von der Discogs-Seite zum Reinhören"],
    ["Audio-Analyse", true, "Energie, Tempo und Tonart aus der Hörprobe, auf dem Gerät"],
    ["Texterkennung", true, "Katalognummer vom Foto lesen, auf dem Gerät"],
    ["Last.fm", me?.features.lastfm, "Vibe-Tags von Hörern"],
    ["GetSongBPM", me?.features.keyLookup, "BPM und Tonart"],
    ["Workers AI", me?.features.freeAi, "Fotos erkennen, Vibes schätzen (kostenlos)"],
    ["Claude", canClaude(me), "Beste Erkennung und Vibes (optional, kostet)"],
  ];
  return (
    <>
      <NavBar title="Datenquellen & KI" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <Group foot="Grau = auf dem Server nicht eingerichtet. Last.fm und GetSongBPM brauchen einen kostenlosen API-Key in Cloudflare.">
          {list.map(([n, on, d]) => (
            <div key={n} className="set-row" style={{ cursor: "default" }}>
              <span className="dot" style={{ background: on ? "var(--ok)" : "var(--surface-3)", width: 10, height: 10 }} />
              <span className="label">
                {n}
                <small>{d}</small>
              </span>
              <span className="value">{on ? "aktiv" : "aus"}</span>
            </div>
          ))}
        </Group>
        <Group title="Eigener Claude-Key" foot="Optional. Damit nutzt du Claude für Fotos und Vibes auf deine Kosten. Der Key bleibt auf diesem Gerät und geht nur zur jeweiligen Anfrage durch den Server.">
          <div className="set-row" style={{ cursor: "default" }}>
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
          </div>
          {ownKey && <Row label="Key entfernen" danger onClick={() => (setOwnKey(""), setOwnAnthropicKey(""), toast("Key entfernt"))} />}
        </Group>
      </div>
    </>
  );
}

function SheetsPage() {
  const [cfg, setCfg] = useState<SheetsConfig>({ url: "", secret: "" });
  useEffect(() => {
    getSheetsConfig().then(setCfg);
  }, []);
  const save = () => setKV("sheets", cfg);
  return (
    <>
      <NavBar title="Google Sheets" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <p className="sub" style={{ margin: "0 4px" }}>
          Spiegelt Sammlung, Wantlist, Tracks und Sets in dein eigenes Google Sheet. Änderungen an BPM, Key, Energie, Vibes, Sternen und Notizen im Blatt „Tracks“ kannst du zurückholen.
        </p>
        <Group title="Verbindung" foot="Einrichtung in 5 Minuten: siehe google-sheets/README.md im Repo (Apps Script als Web-App bereitstellen).">
          <div className="set-row" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <label className="field">
              Apps-Script-URL
              <input className="input" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value.trim() })} onBlur={save} placeholder="https://script.google.com/macros/s/…/exec" />
            </label>
            <label className="field">
              Geheimwort
              <input className="input" type="password" value={cfg.secret} onChange={(e) => setCfg({ ...cfg, secret: e.target.value })} onBlur={save} />
            </label>
          </div>
        </Group>
        <Group foot="Reihenfolge, wenn du im Sheet etwas geändert hast: erst zurückholen, dann schreiben. Schreiben überschreibt die Blätter.">
          <Row icon={<IconSheet />} color="#34c759" label="In Sheets schreiben" onClick={run("Sheets", async () => { await save(); const n = await pushToSheets(); return `Gesendet: ${n.Collection} Platten, ${n.Tracks} Tracks`; })} />
          <Row icon={<IconDownload />} color="#0a84ff" label="Tracks aus Sheets zurückholen" onClick={run("Sheets", async () => { await save(); return `${await pullTracksFromSheets()} Tracks übernommen`; })} />
        </Group>
      </div>
    </>
  );
}

function DataPage() {
  const nav = useNavigate();
  const [usage, setUsage] = useState<string>("…");
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ? `${(e.usage / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : "–"), () => setUsage("–"));
  }, []);
  const counts = useLiveQuery(async () => ({ tracks: await db.tracks.count(), sets: await db.sets.count(), history: await db.priceHistory.count() }));

  const exportBackup = async () => {
    const out: Record<string, unknown[]> = {};
    for (const t of TABLES) out[t] = await db.table(t).toArray();
    download(`crate-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), data: out })], { type: "application/json" }));
    await setKV("lastBackup", Date.now());
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
  const lastBackup = useLiveQuery(() => getKV<number>("lastBackup", 0));

  return (
    <>
      <NavBar title="Speicher & Backup" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <Group title="Auf diesem Gerät" foot="Deine eigenen Daten (BPM, Keys, Sets, Regalplätze, Preisverlauf) liegen nur hier. Discogs-Daten lassen sich jederzeit neu laden.">
          <Row label="Belegter Speicher" value={usage} />
          <Row label="Tracks mit eigenen Daten" value={counts?.tracks ?? "–"} />
          <Row label="Sets" value={counts?.sets ?? "–"} />
          <Row label="Preis-Messpunkte" value={counts?.history ?? "–"} />
        </Group>
        <Group title="Backup" foot={`Letztes Backup: ${when(lastBackup)}`}>
          <Row icon={<IconDownload />} color="#0a84ff" label="Backup herunterladen" onClick={() => exportBackup().catch((e) => toast(e.message))} />
          <label className="set-row press" style={{ cursor: "pointer" }}>
            <span className="ico" style={{ background: "#5e5ce6" }}>
              <IconSync />
            </span>
            <span className="label">Backup einspielen</span>
            <span className="chev">
              <IconChevron />
            </span>
            <input type="file" accept="application/json" hidden onChange={(e) => importBackup(e.target.files?.[0]).catch((err) => toast(err.message))} />
          </label>
          <Row icon={<IconSheet />} color="#34c759" label="Tracks als CSV (Excel)" onClick={() => exportCsv().catch((e) => toast(e.message))} />
        </Group>
        <div className="group">
          <Row
            label="Alle lokalen Daten löschen"
            danger
            onClick={async () => {
              if (!confirm("Wirklich alle lokalen Daten löschen? Eigene BPM, Sets und Regalplätze gehen verloren, wenn es kein Backup gibt.")) return;
              await db.delete();
              nav("/");
              location.reload();
            }}
          />
        </div>
      </div>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <NavBar title="Über Crate" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
          <img src="/icon.svg" width={76} height={76} alt="" style={{ margin: "0 auto", borderRadius: 18 }} />
          <h2 style={{ margin: "12px 0 2px", fontFamily: "var(--font-brand)", fontStretch: "125%", textTransform: "uppercase", letterSpacing: "-0.03em" }}>Crate</h2>
          <div className="sub">
            Version {__APP_VERSION__} · {new Date(__BUILD_DATE__).toLocaleDateString("de-DE")}
          </div>
        </div>
        <Group title="Datenschutz" foot="Crate speichert nichts über dich auf dem Server. Die Anmeldung läuft direkt über Discogs, dein Passwort sieht die App nie.">
          <Row label="Deine Sammlung & eigenen Daten" value="nur auf dem Gerät" />
          <Row label="Discogs-Zugang" value="verschlüsselt im Cookie" />
          <Row label="Anfragen an Discogs" value="von deinem Gerät" />
        </Group>
        <Group title="Daten von">
          <Row label="Discogs" sub="Datenbank, Sammlung, Marktplatz" value="↗" right={<span />} onClick={() => window.open("https://www.discogs.com", "_blank")} />
          <Row label="Deezer" sub="BPM und Hörproben" value="↗" right={<span />} onClick={() => window.open("https://www.deezer.com", "_blank")} />
          <Row label="Last.fm" sub="Vibe-Tags" value="↗" right={<span />} onClick={() => window.open("https://www.last.fm", "_blank")} />
          <Row label="GetSongBPM" sub="BPM und Tonarten" value="↗" right={<span />} onClick={() => window.open("https://getsongbpm.com", "_blank")} />
        </Group>
        <p className="tiny" style={{ textAlign: "center" }}>
          <a href="/credits" style={{ color: "var(--accent)" }}>Alle Datenquellen</a>
        </p>
        <p className="tiny" style={{ textAlign: "center" }}>Diese App nutzt die Discogs-API, ist aber nicht von Discogs entwickelt oder unterstützt.</p>
      </div>
    </>
  );
}

const FAQ: [string, string][] = [
  ["Warum fehlen bei manchen Tracks BPM oder Key?", "Für viele Underground-Pressungen gibt es online keine Daten, und eine Hörprobe nutzt die App nur, wenn Titel, Mix und Länge passen. Tippe auf den Track: Während das Video läuft, misst du das Tempo per TAP selbst."],
  ["Wie spare ich Versand?", "Unter Shoppen findest du die Händler mit den meisten deiner Wants. Lieblingshändler prüft die App nach jedem Sync automatisch. Für den ganzen Markt gibt es das Lesezeichen „Crate holen“."],
  ["Was bedeuten die Farben bei den Preisen?", "Grün: unter Marktwert. Gelb: fair. Rot: gerade teuer. Grundlage ist die Discogs-Preisempfehlung oder dein eigener Preisverlauf."],
  ["Wie funktionieren die Camelot-Keys?", "Jede Tonart hat eine Nummer und einen Buchstaben (A = Moll, B = Dur). Harmonisch passen dieselbe Zahl, ±1 und der Wechsel zwischen A und B bei gleicher Zahl."],
  ["Was ist der Unterschied zwischen Einleger, Obi und Sticker?", "Der Einleger kommt vor das Cover in die transparente Außenhülle. Das Obi ist ein schmaler Streifen für die Seite, der Sticker klebt auf der Außenhülle."],
  ["Kann ich die App mit Freunden teilen?", "Ja, einfach den Link schicken. Jeder meldet sich mit dem eigenen Discogs-Account an, die Daten bleiben auf dem jeweiligen Handy."],
];

function HelpPage() {
  return (
    <>
      <NavBar title="Tipps & Hilfe" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <div className="group">
          {FAQ.map(([q, a]) => (
            <details key={q} style={{ padding: "12px 16px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>{q}</summary>
              <p className="sub" style={{ margin: "8px 0 0" }}>
                {a}
              </p>
            </details>
          ))}
        </div>
        <Group title="Tipp">
          <Row label="Als App installieren" sub="Im Browsermenü „Zum Startbildschirm hinzufügen“ wählen. Dann startet Crate wie eine echte App und funktioniert offline." />
        </Group>
      </div>
    </>
  );
}
