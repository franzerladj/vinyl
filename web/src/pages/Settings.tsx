// Einstellungen im iOS-Stil: Übersicht mit Gruppen, Unterseiten pro Bereich.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV, type Release } from "../lib/db";
import { canClaude, discogs as discogsApi, logout, ownAnthropicKey, setOwnAnthropicKey } from "../lib/api";
import { getSheetsConfig, pullTracksFromSheets, pushToSheets, type SheetsConfig } from "../lib/sheets";
import { autoPipeline, fetchMissingDetails, getAutoSettings, lookupAudioFor, tagVibes, type AutoSettings } from "../lib/sync";
import { suggestionsState } from "../lib/prices";
import { ask, toast, useStore } from "../lib/store";
import { getTheme, hapticsEnabled, setHaptics, setTheme, setYtConsent, ytConsent, type Theme } from "../lib/theme";
import { Avatar, Cover, haptic, Seg, useDebounced } from "../components/bits";
import { matchesQuery, matchScore as textScore, queryTokens } from "../../../shared/textSearch";
import type { SearchResult } from "../lib/types";
import type { MyProfile } from "../lib/friends";
import { NavBar, Switch } from "../components/ui";
import { ShippingEditor } from "../components/ShippingEditor";
import { ProfileHeader } from "../components/ProfileCard";
import { ShareCardSheet } from "../components/ShareCard";
import { renderProfileCard } from "../lib/shareCard";
import { inviteLink } from "../lib/friends";
import { loadMyProfile, saveMyProfile } from "../lib/profile";
import { GEAR, linkText, LINK_LABEL, parseLink, PLAY_LABEL, sanitizeProfile, type CrateProfile, type GearSlot, type PlayMode } from "../../../shared/profile";
import { DEFAULT_PREFS, disablePush, enablePush, isIOS, pushStatus, pushSupport, savePushPrefs, sendTestPush, type PushKind, type PushPrefs } from "../lib/push";
import { DEFAULT_SHIP, type ShipConfig } from "../../../shared/shipping";
import {
  IconBell,
  IconBolt,
  IconPlay,
  IconChevron,
  IconCoin,
  IconDatabase,
  IconDownload,
  IconHelp,
  IconInfo,
  IconSheet,
  IconSun,
  IconSync,
  IconWave,
  IconUser,
  IconShare,
  IconRecord,
} from "../components/icons";
import { computeStylus, hoursText, saveStylus, today } from "../lib/stylus";
import { deleteDevSyncData, devSyncOff, lastDevSync, pushEverything, setDevSync, syncNow } from "../lib/devsync";

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
    case "notifications":
      return <NotificationsPage />;
    case "profile":
      return <ProfileEditPage />;
    case "stylus":
      return <StylusPage />;
    case "devices":
      return <DevicesPage />;
    default:
      return <Overview />;
  }
}

/** „heute“, „gestern“ oder kurzes Datum: spart Platz in schmalen Zeilen */
function relDay(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return "heute";
  if (diff === 1) return "gestern";
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
}

function Overview() {
  const me = useStore((s) => s.me);
  const [theme, setT] = useState<Theme>(getTheme());
  const [haptics, setH] = useState(hapticsEnabled());
  const [yt, setYt] = useState(ytConsent() === "yes");
  const pushOn = useLiveQuery(() => getKV("pushOn", false), [], false);
  const profile = useLiveQuery(() => getKV<MyProfile | null>("myProfile", null));
  const stylus = useLiveQuery(() => computeStylus(), []);
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
  const devLast = useLiveQuery(() => lastDevSync(), [], 0);
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
          <Row label="Crate-Profil bearbeiten" sub="DJ-Name, Bio, Links, Setup, Platte des Moments" to="/settings/profile" />
          <Row label="Profil auf Discogs" value="↗" onClick={() => window.open(`https://www.discogs.com/user/${me?.username}`, "_blank")} right={<span />} />
        </div>

        <Group title="Bibliothek">
          <Row icon={<IconSync />} color="#30d158" label="Abgleich & Ergänzen" value={stats?.lastSync ? relDay(stats.lastSync) : "nie"} to="/settings/sync" />
          <Row icon={<IconCoin />} color="#ff9f0a" label="Preise & Shopping" value={stats?.currency} to="/settings/prices" />
          <Row icon={<IconWave />} color="#5e5ce6" label="Datenquellen" value={`${sources} aktiv`} to="/settings/sources" />
          <Row icon={<IconSync />} color="#0a84ff" label="Handy und Computer" sub="BPM, Keys, Sets und Notizen auf allen Geräten gleich" value={devLast ? relTime(devLast) : "gleich"} to="/settings/devices" />
        </Group>

        <Group title="Freunde">
          <Row icon={<IconUser />} color="#bf5af2" label="Freunde" value={stats?.friends ?? 0} to="/friends" />
          <Row icon={<IconShare />} color="#ff9f0a" label="Verliehene Platten" value={stats?.lent ?? 0} to="/friends?tab=lent" />
          <Row icon={<IconRecord />} color="#8a5a2b" label="Nadel-Stunden" value={stylus ? hoursText(stylus.minutes) : "einrichten"} to="/settings/stylus" />
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
          <Row
            icon={<IconPlay />}
            color="#ff3b30"
            label="YouTube-Videos direkt laden"
            sub="Sonst erst nach Antippen. YouTube erfährt dabei deine IP-Adresse."
            right={
              <Switch
                checked={yt}
                label="YouTube-Videos direkt laden"
                onChange={(v) => {
                  setYt(v);
                  setYtConsent(v ? "yes" : "no");
                }}
              />
            }
          />
        </Group>

        <Group title="Mitteilungen">
          <Row icon={<IconBell />} color="#ff3b30" label="Mitteilungen" value={pushOn ? "an" : "aus"} to="/settings/notifications" />
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
                if (!(await ask({ title: "Von Discogs abmelden?", body: "Mitteilungen werden auf diesem Gerät ausgeschaltet. Deine Platten, Sets und Notizen bleiben hier, bis sich ein anderes Konto anmeldet.", ok: "Abmelden", danger: true }))) return;
                // Server soll den Discogs-Zugang für Mitteilungen nicht weiter nutzen
                await import("../lib/push").then((p) => p.disablePush()).catch(() => undefined);
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
      <NavBar title="Abgleich" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <div>
          <button className="btn primary block lg" disabled={busy} onClick={run("Sync", async () => (await autoPipeline({ force: true }), "Alles synchron und analysiert"))}>
            {busy ? "Läuft gerade …" : "Jetzt abgleichen & ergänzen"}
          </button>
          <p className="tiny" style={{ textAlign: "center" }}>
            Zuletzt: {when(info?.lastSync)}
          </p>
        </div>

        <Group title="Automatisch" foot="Nach jedem Sync ergänzt die App fehlende Tracklists, BPM, Keys, Vibes und Preise. Deine Aktionen haben dabei immer Vorrang.">
          <Row label="Nach dem Sync ergänzen" right={<Switch checked={auto.analyze} label="Nach dem Sync ergänzen" onChange={(v) => save({ ...auto, analyze: v })} />} />
          <Row label="Hörproben ausmessen" sub="Tempo, Tonart, Energie · ca. 0,5 MB pro Track" right={<Switch checked={auto.audio} label="Hörproben ausmessen" onChange={(v) => save({ ...auto, audio: v })} />} />
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
            icon={<IconBolt />}
            color="#ff9f0a"
            label="Stimmung & Energie ergänzen"
            onClick={run("Vibes", async () => `${await tagVibes(undefined, { audio: auto.audio })} Tracks ergänzt`)}
          />
        </Group>
      </div>
    </>
  );
}

const SHOP_DEFAULTS = { firstItem: 7, perExtraItem: 1.5, maxPrice: "", minRating: "98", minCondition: "VG+", maxSellers: "", ship: DEFAULT_SHIP as ShipConfig };

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

        <Group title="Versand-Schätzung">
          <div style={{ padding: "12px 14px" }}>
            <ShippingEditor value={shop.ship} onChange={(ship) => saveShop({ ship })} />
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
    ["Hörproben ausmessen", true, "Energie, Tempo und Tonart aus der Hörprobe, auf dem Gerät"],
    ["Texterkennung", true, "Katalognummer vom Foto lesen, auf dem Gerät"],
    ["Last.fm", me?.features.lastfm, "Vibe-Tags von Hörern"],
    ["GetSongBPM", me?.features.keyLookup, "BPM und Tonart"],
    ["Workers AI", me?.features.freeAi, "Fotos erkennen, Vibes schätzen (kostenlos)"],
    ["Claude", canClaude(me), "Beste Erkennung und Vibes (optional, kostet)"],
  ];
  return (
    <>
      <NavBar title="Datenquellen" backTo="/settings" backLabel="Einstellungen" />
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
              if (!(await ask({ title: "Alle lokalen Daten löschen?", body: "Eigene BPM, Sets und Regalplätze gehen verloren, wenn es kein Backup gibt.", ok: "Löschen", danger: true }))) return;
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
  const nav = useNavigate();
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
          <Row label="Deine Daten" value="nur auf dem Gerät" />
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
        <Group title="Rechtliches">
          <Row label="Impressum" onClick={() => nav("/impressum")} />
          <Row label="Datenschutz" onClick={() => nav("/datenschutz")} />
        </Group>
        <p className="tiny" style={{ textAlign: "center" }}>Diese App nutzt die Discogs-API, ist aber nicht mit Discogs verbunden, gesponsert oder von Discogs unterstützt.</p>
      </div>
    </>
  );
}

const FAQ: [string, string][] = [
  ["Warum fehlen bei manchen Tracks BPM oder Key?", "Für viele Underground-Pressungen gibt es online keine Daten, und eine Hörprobe nutzt die App nur, wenn Titel, Mix und Länge passen. Tippe auf den Track: Während das Video läuft, misst du das Tempo per TAP selbst."],
  ["Wie spare ich Versand?", "Unter Shoppen findest du die Händler mit den meisten deiner Wants. Lieblingshändler prüft die App nach jedem Sync automatisch. Neue Händler fügst du dort per Name oder Shop-Link hinzu."],
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

const PUSH_KINDS: [PushKind, string, string][] = [
  ["friends", "Neue Freundschaften", "Wenn dich jemand in Crate als Freund hinzufügt"],
  ["wants", "Wantlist", "Wieder verfügbar, Preis gefallen oder unter deinem Wunschpreis"],
  ["sellers", "Lieblingshändler", "Neue Angebote für deine Wants nach dem Sync"],
  ["lent", "Verliehene Platten", "Erinnerung nach 3, 6 und 10 Wochen"],
  ["sets", "Set-Termine", "Am Tag des Sets: Platten einpacken"],
];

function NotificationsPage() {
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    void (async () => {
      const local = await getKV("pushOn", false);
      const st = await pushStatus().catch(() => null);
      setAvailable(st?.available ?? true);
      setOn(Boolean(local && st && st.devices > 0 && "Notification" in window && Notification.permission === "granted"));
      if (st?.prefs) setPrefs(st.prefs);
    })();
  }, []);
  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      if (v) {
        const p = await enablePush(prefs);
        setPrefs(p);
        await setKV("pushPrefs", p);
        toast("Mitteilungen sind an");
      } else {
        await disablePush();
        toast("Mitteilungen sind aus");
      }
      setOn(v);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setPref = async (k: PushKind, v: boolean) => {
    const p = { ...prefs, [k]: v };
    setPrefs(p);
    await setKV("pushPrefs", p);
    await savePushPrefs({ [k]: v }).catch((e) => toast(e.message));
  };
  return (
    <>
      <NavBar title="Mitteilungen" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        {support === "install" ? (
          <Group title="Zuerst installieren" foot="Apple erlaubt Mitteilungen nur für Web-Apps auf dem Home-Bildschirm (ab iOS 16.4).">
            <div style={{ padding: "12px 14px" }} className="stack">
              <span>1. Unten in Safari auf das Teilen-Symbol tippen</span>
              <span>2. „Zum Home-Bildschirm“ wählen</span>
              <span>3. Crate vom Home-Bildschirm öffnen und hier Mitteilungen einschalten</span>
            </div>
          </Group>
        ) : support === "unsupported" ? (
          <Group foot="Dieser Browser kann keine Mitteilungen empfangen. Am Handy klappt es mit Chrome (Android) oder als installierte App (iPhone).">
            <Row label="Mitteilungen" value="nicht möglich" />
          </Group>
        ) : (
          <>
            <Group foot={available ? "Für Wantlist und Erinnerungen prüft Crate alle 10 Minuten bei Discogs. Dafür liegen deine Wants, Wunschpreise und Termine verschlüsselt auf dem Server, nur solange Mitteilungen an sind." : "Mitteilungen sind auf dem Server noch nicht eingerichtet."}>
              <Row
                icon={<IconBell />}
                color="#ff3b30"
                label="Mitteilungen erlauben"
                sub={on ? "Auf diesem Gerät an" : "Auf diesem Gerät aus"}
                right={<Switch checked={Boolean(on)} label="Mitteilungen erlauben" onChange={(v) => !busy && on !== null && toggle(v)} />}
              />
            </Group>
            <Group title="Worüber">
              {PUSH_KINDS.map(([k, l, d]) => (
                <Row key={k} label={l} sub={d} right={<Switch checked={prefs[k]} label={l} onChange={(v) => setPref(k, v)} />} />
              ))}
            </Group>
            {on && (
              <Group>
                <Row
                  label="Test-Mitteilung senden"
                  onClick={() =>
                    sendTestPush().then(
                      (r) => toast(r.sent ? "Gesendet. Sie sollte gleich erscheinen." : "Konnte nicht zugestellt werden. Bitte Mitteilungen aus- und wieder einschalten."),
                      (e) => toast(e.message),
                    )
                  }
                />
              </Group>
            )}
            {isIOS() && <p className="tiny" style={{ textAlign: "center" }}>Auf dem iPhone kommen Mitteilungen nur, solange Crate auf dem Home-Bildschirm liegt.</p>}
          </>
        )}
      </div>
    </>
  );
}

function ProfileEditPage() {
  const me = useStore((s) => s.me);
  const nav = useNavigate();
  const discogs = useLiveQuery(() => getKV<MyProfile | null>("myProfile", null));
  const [p, setP] = useState<CrateProfile>({ links: [], styles: [] });
  const [loaded, setLoaded] = useState(false);
  const [linkIn, setLinkIn] = useState("");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const records = useLiveQuery(() => db.collection.count(), [], 0);
  useEffect(() => {
    void loadMyProfile().then((x) => {
      if (x) setP(x);
      setLoaded(true);
    });
  }, []);
  // Styles aus der eigenen Sammlung, häufigste zuerst
  const myStyles = useLiveQuery(async () => {
    const ids = [...new Set((await db.collection.toArray()).map((c) => c.releaseId))];
    const count = new Map<string, number>();
    for (const r of await db.releases.bulkGet(ids)) for (const st of r?.styles ?? []) count.set(st, (count.get(st) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k]) => k);
  }, [], [] as string[]);
  // Sammlung und Wantlist durchsuchen, auch in Tracks und Label; Titel-Treffer zuerst
  const dqPick = useDebounced(q, 200);
  const picks = useLiveQuery(async () => {
    const tokens = queryTokens(dqPick);
    if (!tokens.length || dqPick.trim().length < 2) return [] as { r: Release; where: "coll" | "want" }[];
    const [coll, wants] = await Promise.all([db.collection.toArray(), db.wants.toArray()]);
    const own = new Set(coll.map((c) => c.releaseId));
    const ids = [...new Set([...own, ...wants.map((w) => w.releaseId)])];
    const rels = (await db.releases.bulkGet(ids)).filter(Boolean) as Release[];
    return rels
      .filter((r) => matchesQuery(`${r.artist} ${r.title} ${(r.tracklist ?? []).map((t) => t.title).join(" ")} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")}`, tokens))
      .map((r) => ({ r, where: own.has(r.id) ? ("coll" as const) : ("want" as const), score: textScore(`${r.artist} ${r.title}`, tokens) + (own.has(r.id) ? 0.1 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [dqPick], []);
  // Nichts in der eigenen Kiste? Dann direkt bei Discogs suchen
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const dqRemote = useDebounced(q, 600);
  useEffect(() => {
    setRemote([]);
    if (dqRemote.trim().length < 3) return;
    let alive = true;
    discogsApi<{ results: SearchResult[] }>(`/database/search?type=release&per_page=8&q=${encodeURIComponent(queryTokens(dqRemote).join(" "))}`)
      .then((d) => alive && setRemote(d.results))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dqRemote]);
  const set = (patch: Partial<CrateProfile>) => setP((x) => ({ ...x, ...patch }));
  const addLink = () => {
    const l = parseLink(linkIn);
    if (!l) return toast("Das sieht nicht nach einem Link aus");
    if (p.links.length >= 5) return toast("Höchstens 5 Links");
    set({ links: [...p.links.filter((x) => x.url !== l.url), l] });
    setLinkIn("");
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveMyProfile(sanitizeProfile(p));
      haptic(15);
      toast("Profil gespeichert");
      nav("/settings", { viewTransition: true });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const bioLeft = 300 - (p.bio?.length ?? 0);
  return (
    <>
      <NavBar
        title="Crate-Profil"
        backTo="/settings"
        backLabel="Einstellungen"
        right={
          <button className="text-btn" onClick={save} disabled={saving || !loaded}>
            Sichern
          </button>
        }
      />
      <div className="page settings-list">
        <Group title="So sehen dich Freunde">
          <div style={{ padding: "16px 14px" }}>
            <ProfileHeader username={me?.username ?? ""} avatar={discogs?.avatar} discogsName={discogs?.name} location={discogs?.location} profile={sanitizeProfile(p)} />
          </div>
        </Group>

        <Group title="Über dich" foot="Profilbild und Discogs-Name kommen von Discogs.">
          <label className="pe-field">
            <span>DJ-Name</span>
            <input className="input" maxLength={40} placeholder={discogs?.name || me?.username || ""} value={p.djName ?? ""} onChange={(e) => set({ djName: e.target.value })} />
          </label>
          <label className="pe-field">
            <span>Ort</span>
            <input className="input" maxLength={60} placeholder={discogs?.location || "z. B. Bayreuth"} value={p.location ?? ""} onChange={(e) => set({ location: e.target.value })} />
          </label>
          <label className="pe-field">
            <span>
              Bio <small className={bioLeft < 30 ? "warn" : ""}>{bioLeft}</small>
            </span>
            <textarea className="input" rows={4} maxLength={300} placeholder="Was legst du auf, wo spielst du, was suchst du gerade?" value={p.bio ?? ""} onChange={(e) => set({ bio: e.target.value })} />
          </label>
        </Group>

        <Group title="Links" foot="Instagram, SoundCloud, Mixcloud, Bandcamp, Resident Advisor oder die eigene Website. „@name“ geht auch für Instagram.">
          {p.links.map((l) => (
            <div key={l.url} className="set-row" style={{ cursor: "default" }}>
              <span className="label">
                {linkText(l)}
                <small>{LINK_LABEL[l.kind]}</small>
              </span>
              <button className="icon-btn" aria-label="Link entfernen" onClick={() => set({ links: p.links.filter((x) => x.url !== l.url) })}>
                ✕
              </button>
            </div>
          ))}
          {p.links.length < 5 && (
            <form
              className="pe-add"
              onSubmit={(e) => {
                e.preventDefault();
                addLink();
              }}
            >
              <input className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="Link einfügen" value={linkIn} onChange={(e) => setLinkIn(e.target.value)} />
              <button className="btn small tinted" disabled={!linkIn.trim()}>
                Hinzufügen
              </button>
            </form>
          )}
        </Group>

        <Group title={`Deine Styles (${p.styles.length}/6)`} foot="Vorschläge aus deiner Sammlung, häufigste zuerst.">
          <div className="chips" style={{ padding: "12px 14px" }}>
            {[...new Set([...p.styles, ...myStyles])].map((st) => {
              const on = p.styles.includes(st);
              return (
                <button key={st} className={`chip ${on ? "on" : ""}`} onClick={() => (on ? set({ styles: p.styles.filter((x) => x !== st) }) : p.styles.length < 6 ? set({ styles: [...p.styles, st] }) : toast("Höchstens 6 Styles"))}>
                  {st}
                </button>
              );
            })}
          </div>
        </Group>

        <Group title="Setup" foot="Was bei dir steht, zu Hause oder im Club. Tippe in ein Feld für Vorschläge oder schreib frei.">
          <div className="chip-wrap" style={{ padding: "12px 14px 6px" }} role="radiogroup" aria-label="Spielweise">
            {(Object.keys(PLAY_LABEL) as PlayMode[]).map((m) => (
              <button key={m} role="radio" aria-checked={p.plays === m} className={`chip ${p.plays === m ? "on" : ""}`} onClick={() => (haptic(5), set({ plays: p.plays === m ? undefined : m }))}>
                {PLAY_LABEL[m]}
              </button>
            ))}
          </div>
          {GEAR.map((g) => (
            <label key={g.id} className="pe-field">
              <span>{g.label}</span>
              <input
                className="input"
                maxLength={80}
                list={`gear-${g.id}`}
                autoCapitalize="words"
                autoCorrect="off"
                placeholder={g.placeholder}
                value={p.setup?.[g.id] ?? ""}
                onChange={(e) => set({ setup: { ...p.setup, [g.id as GearSlot]: e.target.value } })}
              />
              <datalist id={`gear-${g.id}`}>
                {g.suggest.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
          ))}
        </Group>

        <Group title="Platte des Moments">
          {p.spotlight ? (
            <div className="set-row" style={{ cursor: "default" }}>
              <span className="label">
                {p.spotlight.title}
                <small>{p.spotlight.artist}</small>
              </span>
              <button className="icon-btn" aria-label="Entfernen" onClick={() => set({ spotlight: undefined })}>
                ✕
              </button>
            </div>
          ) : null}
          <div style={{ padding: "10px 14px" }}>
            <input className="input" placeholder={p.spotlight ? "Andere Platte suchen …" : "Platte aus deiner Kiste suchen …"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {picks.map(({ r, where }) => (
            <button
              key={r.id}
              className="set-row pick-row"
              onClick={() => {
                set({ spotlight: { id: r.id, title: r.title, artist: r.artist, cover: r.cover || r.thumb } });
                setQ("");
              }}
            >
              <Cover src={r.thumb || r.cover} />
              <span className="label">
                {r.title}
                <small>
                  {r.artist}
                  {where === "want" ? " · auf deiner Wantlist" : ""}
                </small>
              </span>
              <span className="chev">+</span>
            </button>
          ))}
          {q.trim().length >= 3 && remote.filter((x) => !picks.some((p) => p.r.id === x.id)).length > 0 && (
            <>
              <div className="pick-head">{picks.length ? "Weitere bei Discogs" : "Nicht in deiner Kiste, aber bei Discogs"}</div>
              {remote
                .filter((x) => !picks.some((p) => p.r.id === x.id))
                .slice(0, 6)
                .map((x) => {
                  const i = x.title.indexOf(" - ");
                  const artist = i > 0 ? x.title.slice(0, i).replace(/\s\(\d+\)$/, "") : "";
                  const title = i > 0 ? x.title.slice(i + 3) : x.title;
                  return (
                    <button
                      key={x.id}
                      className="set-row pick-row"
                      onClick={() => {
                        set({ spotlight: { id: x.id, title, artist, cover: x.cover_image || x.thumb } });
                        setQ("");
                      }}
                    >
                      <Cover src={x.thumb} />
                      <span className="label">
                        {title}
                        <small>{[artist, x.label?.[0], x.year].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="chev">+</span>
                    </button>
                  );
                })}
            </>
          )}
          {q.trim().length >= 2 && !picks.length && !remote.length && <div className="pick-head">Suche …</div>}
        </Group>

        <button className="btn primary block" onClick={save} disabled={saving || !loaded}>
          {saving ? "Speichert …" : "Profil speichern"}
        </button>
        <button className="btn block" onClick={() => setSharing(true)} disabled={!loaded}>
          Als Story teilen
        </button>
        <ShareCardSheet
          open={sharing}
          onClose={() => setSharing(false)}
          title="Dein Profil als Story"
          filename={`crate-${me?.username ?? "profil"}.png`}
          text={`Folg mir auf Crate: ${inviteLink()}`}
          make={() => renderProfileCard({ username: me?.username ?? "", name: discogs?.name, avatar: discogs?.avatar, location: discogs?.location, profile: sanitizeProfile(p), records, inviteUrl: inviteLink() })}
        />
        <p className="tiny" style={{ textAlign: "center" }}>Sichtbar für angemeldete Crate-Nutzer, die dich als Freund hinzufügen. In der Suche erscheinst du nur, wenn du auf der Freunde-Seite „Für Freunde auffindbar“ eingeschaltet hast.</p>
      </div>
    </>
  );
}

/** Nadel-Stunden: seit dem letzten Wechsel, aus gespielten Sets und eigenen Sessions */
function StylusPage() {
  const data = useLiveQuery(() => computeStylus(), []);
  const [life, setLife] = useState("");
  useEffect(() => {
    if (data?.state.lifeHours) setLife(String(data.state.lifeHours));
  }, [data?.state.lifeHours]);
  const st = data?.state ?? { since: today(), extraMinutes: 0 };
  // Beim ersten Öffnen ab heute zählen; der Einbautag lässt sich unten zurückdatieren
  useEffect(() => {
    if (data === null) void saveStylus({ since: today(), extraMinutes: 0 });
  }, [data]);
  const add = (min: number) => {
    haptic(8);
    void saveStylus({ ...st, extraMinutes: Math.max(0, (st.extraMinutes || 0) + min) });
  };
  const wear = data?.wear ?? null;
  return (
    <>
      <NavBar title="Nadel-Stunden" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <div className="stylus-hero">
          <span className="eyebrow">Seit {new Date(st.since).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}</span>
          <b className="value-big">{data ? hoursText(data.minutes) : "0 Min."}</b>
          {wear != null ? (
            <>
              <div className="shared-meter" aria-hidden>
                <span style={{ width: `${wear * 100}%`, background: wear >= 0.9 ? "var(--bad)" : wear >= 0.7 ? "var(--warn)" : undefined }} />
              </div>
              <span className="sub">{wear >= 1 ? "Die Lebensdauer ist erreicht. Zeit für eine neue Nadel." : wear >= 0.9 ? "Bald wechseln: eine abgenutzte Nadel klingt dumpfer und schadet den Rillen." : `${Math.round(wear * 100)} % der angegebenen Lebensdauer`}</span>
            </>
          ) : (
            <span className="sub">Trag unten die Lebensdauer laut Hersteller ein, dann zeigt Crate, wann ein Wechsel ansteht.</span>
          )}
        </div>
        <Group title="Sessions ohne Set" foot="Gespielte Sets zählen von selbst, mit der Länge ihrer Tracks. Üben und Digging zu Hause trägst du hier ein.">
          <div className="chip-wrap" style={{ padding: "12px 14px" }}>
            {[
              [30, "+30 Min."],
              [60, "+1 Std."],
              [180, "+3 Std."],
              [-60, "−1 Std."],
            ].map(([m, l]) => (
              <button key={l} className="chip" onClick={() => add(m as number)}>
                {l}
              </button>
            ))}
          </div>
        </Group>
        <Group title="Nadel">
          <label className="pe-field">
            <span>Eingebaut am</span>
            <input className="input" type="date" max={today()} value={st.since} onChange={(e) => e.target.value && void saveStylus({ ...st, since: e.target.value })} />
          </label>
          <label className="pe-field">
            <span>Lebensdauer laut Hersteller (Stunden)</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="steht in der Anleitung der Nadel"
              value={life}
              onChange={(e) => setLife(e.target.value.replace(/\D/g, ""))}
              onBlur={() => void saveStylus({ ...st, lifeHours: Number(life) || undefined })}
            />
          </label>
          <Row
            label="Neue Nadel eingebaut"
            sub="Zählt ab heute neu"
            onClick={async () => {
              if (!(await ask({ title: "Neue Nadel eingebaut?", body: "Die Stunden zählen ab heute neu.", ok: "Ja, neu" }))) return;
              haptic(15);
              void saveStylus({ since: today(), lifeHours: Number(life) || undefined, extraMinutes: 0 }).then(() => toast("Neue Nadel, frischer Klang"));
            }}
          />
        </Group>
      </div>
    </>
  );
}

const relTime = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "gerade" : m < 60 ? `vor ${m} Min.` : relDay(t);
};

/** Abgleich zwischen Geräten: was wandert mit, wann zuletzt, dieses Gerät als Vorlage */
function DevicesPage() {
  const last = useLiveQuery(() => lastDevSync(), [], 0);
  const off = useLiveQuery(() => devSyncOff(), [], false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast((e as Error).message.includes("401") ? "Bitte kurz warten, die Anmeldung wird noch bestätigt" : "Gerade keine Verbindung, Crate versucht es später nochmal");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <NavBar title="Geräte" backTo="/settings" backLabel="Einstellungen" />
      <div className="page settings-list">
        <Group foot="Sammlung, Wantlist, Ordner, Zustand und Kaufpreis kommen ohnehin von Discogs. Hier geht es um das, was du in Crate selbst einträgst.">
          <div className="set-row" style={{ cursor: "default", alignItems: "flex-start" }}>
            <span className="ico" style={{ background: "#0a84ff" }}>
              <IconSync />
            </span>
            <div style={{ flex: 1 }}>
              <b>Läuft automatisch</b>
              <div className="sub" style={{ marginTop: 4 }}>
                BPM, Keys, Energie, Sterne, Notizen und Cue-Punkte, Sets, Regalplätze, Kisten-Vorlagen, Wunschpreise, Händler, Freunde, Likes und Nadel-Stunden sind auf allen Geräten gleich, auf denen du mit deinem Discogs-Konto angemeldet bist.
              </div>
              <div className="sub" style={{ marginTop: 8 }}>Zuletzt abgeglichen: {last ? relTime(last) : "noch nie"}</div>
            </div>
          </div>
          <div className="set-row" style={{ cursor: "default" }}>
            <span style={{ flex: 1 }}>Auf diesem Gerät abgleichen</span>
            <Switch label="Auf diesem Gerät abgleichen" checked={!off} onChange={(v) => void setDevSync(v).then(() => toast(v ? "Abgleich eingeschaltet" : "Abgleich auf diesem Gerät aus"))} />
          </div>
          {!off && <Row label="Jetzt abgleichen" onClick={() => !busy && void run(syncNow, "Abgeglichen")} right={<span />} />}
        </Group>
        <Group title="Wenn zwei Geräte verschiedene Werte haben" foot="Von Hand eingetragene BPM, Keys und Energie werden nie durch eine automatische Messung eines anderen Geräts ersetzt. Sonst gilt die neuere Änderung.">
          <Row
            label="Dieses Gerät als Vorlage nehmen"
            sub="Schickt alles von hier an deine anderen Geräte"
            onClick={async () => {
              if (busy || !(await ask({ title: "Dieses Gerät als Vorlage?", body: "Deine anderen Geräte übernehmen BPM, Sets und Notizen von hier. Werte, die nur dort stehen, bleiben erhalten.", ok: "Übernehmen" }))) return;
              await run(pushEverything, "Deine anderen Geräte übernehmen den Stand beim nächsten Öffnen");
            }}
            right={<span />}
          />
        </Group>
        <Group foot="Löscht die abgeglichenen Daten auf dem Server. Auf deinen Geräten bleibt alles, der Abgleich wird auf diesem Gerät ausgeschaltet.">
          <Row
            label="Daten vom Server löschen"
            danger
            onClick={async () => {
              if (busy || !(await ask({ title: "Abgleich-Daten löschen?", body: "Auf deinen Geräten bleibt alles. Auf dem Server wird nichts mehr gespeichert, bis du den Abgleich wieder einschaltest.", ok: "Löschen", danger: true }))) return;
              await run(deleteDevSyncData, "Vom Server gelöscht");
            }}
          />
        </Group>
      </div>
    </>
  );
}
