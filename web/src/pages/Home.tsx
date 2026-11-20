import { useBuzz } from "../lib/buzz";
import { apkName, apkOutdated, canSelfUpdate, LATEST_APK, nativePush, nativeToken, updateApp } from "../lib/push";
import { Hint } from "../components/Welcome";
import { DailyRecord } from "../components/DailyRecord";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, type DJSet } from "../lib/db";
import { cachedSocial } from "../lib/social";
import { FriendsHome } from "../components/FriendsHome";
import { friendMatches, type MyProfile } from "../lib/friends";
import { autoPipeline, isPipelineRunning } from "../lib/sync";
import { SyncStatus } from "../components/SyncStatus";
import { toast, useStore } from "../lib/store";
import { Avatar, Cover, Empty, haptic, markHero, useRootClass } from "../components/bits";
import { DjOverview } from "../components/DjOverview";
import { computeStylus, hoursText } from "../lib/stylus";
import { IconCamera, IconCart, IconChat, IconInfo, IconList, IconPlay, IconRecord, IconSearch, IconSleeves, IconTag, IconUser, IconWave } from "../components/icons";
import { reviewSeason } from "../../../shared/year";
import type { ReactNode } from "react";

/** Begrüßung mit DJ-Bezug je nach Tageszeit. Wechselt täglich, damit sie nicht jeden Tag gleich ist. */
export function greeting(name: string, opts: { setToday?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const h = now.getHours();
  if (opts.setToday && h >= 7) return `Heute ist Set-Tag, ${name}`;
  const lines =
    h >= 22 || h < 5
      ? [`Noch am Diggen, ${name}?`, `Späte Session, ${name}?`, `Eine Platte geht noch, ${name}`]
      : h < 10
        ? [`Guten Morgen, ${name}`, `Kaffee und Platten, ${name}?`]
        : h < 14
          ? [`Hallo ${name}`, `Was läuft heute, ${name}?`]
          : h < 18
            ? [`Hallo ${name}`, `Zeit zum Sortieren, ${name}?`, `Was liegt heute auf, ${name}?`]
            : [`Guten Abend, ${name}`, `Bereit für heute Abend, ${name}?`];
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  return lines[day % lines.length];
}

/** Werkzeug auf Start: kurze Namen, damit vier nebeneinander auch auf 320 px passen */
const TOOLS: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/scan", label: "Scannen", icon: <IconCamera /> },
  { to: "/stickers", label: "Beschriften", icon: <IconTag /> },
  { to: "/sets/new", label: "Neues Set", icon: <IconList /> },
  { to: "/shop", label: "Shop", icon: <IconCart /> },
  { to: "/labels", label: "Labels", icon: <IconSleeves /> },
  { to: "/settings/stylus", label: "Nadel", icon: <IconRecord /> },
  { to: "/dj", label: "Übersicht", icon: <IconWave /> },
  { to: "/guide", label: "Wissen", icon: <IconInfo /> },
];

export default function Home() {
  const season = reviewSeason();
  const stylus = useLiveQuery(() => computeStylus(), []);
  const me = useStore((s) => s.me);
  const jobs = useStore((s) => s.jobs);
  const busy = Object.keys(jobs).length > 0;

  const profile = useLiveQuery(() => getKV<MyProfile | null>("myProfile", null));
  const social = useLiveQuery(() => cachedSocial(), []);
  const buzz = useBuzz();
  const stats = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const [metas, tracks] = await Promise.all([db.recordMeta.bulkGet(ids), db.tracks.where("releaseId").anyOf(ids).toArray()]);
    const recent = [...coll].sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 12);
    const nextSet = (await db.sets.toArray()).filter((s) => s.date && s.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date!.localeCompare(b.date!))[0];
    // Cover für die Gig-Karte: Platten der ersten Tracks, sonst aus der Kiste
    const gigTracks = nextSet ? ((await db.tracks.bulkGet(nextSet.trackIds.slice(0, 16))).filter(Boolean) as { releaseId: number }[]) : [];
    const gigRelIds = nextSet ? [...new Set([...gigTracks.map((t) => t.releaseId), ...(nextSet.crateIds ?? [])])] : [];
    const gigCovers = ((await db.releases.bulkGet(gigRelIds.slice(0, 4))).filter(Boolean) as { thumb?: string; cover?: string }[]).map((r) => r.thumb || r.cover || "").filter(Boolean);
    return {
      records: ids.length,
      wants: await db.wants.count(),
      tracks: tracks.length,
      withBpm: tracks.filter((t) => t.bpm).length,
      withKey: tracks.filter((t) => t.key).length,
      withEnergy: tracks.filter((t) => t.energy != null).length,
      noSticker: ids.filter((_, i) => !metas[i]?.stickerPrintedAt).length,
      sets: await db.sets.count(),
      nextSet,
      gigCovers,
      gigRecords: gigRelIds.length,
      listings: await db.listings.count(),
      recent: (await db.releases.bulkGet(recent.map((r) => r.releaseId))).filter(Boolean),
      lastSync: await getKV<number>("lastCollectionSync", 0),
      friends: await Promise.all((await db.friends.orderBy("addedAt").reverse().toArray()).map(async (f) => ({ f, m: await friendMatches(f.username) }))),
    };
  });


  const sync = async () => {
    if (isPipelineRunning()) return toast("Sync läuft schon");
    haptic();
    try {
      await autoPipeline({ force: true });
      toast("Alles abgeglichen und ergänzt");
    } catch (e) {
      toast(`Sync fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  // Auf schmalen Handys kürzerer Wochentag, damit die Zeile nicht umbricht
  const today = new Date().toLocaleDateString("de-DE", { weekday: window.innerWidth < 360 ? "short" : "long", day: "numeric", month: "long" });
  const firstName = profile?.name?.split(" ")[0] || me?.username || "";
  const todayIso = new Date().toISOString().slice(0, 10);
  const setToday = stats?.nextSet?.date === todayIso;
  const gigSoon = Boolean(stats?.nextSet?.date && (new Date(stats.nextSet.date).getTime() - new Date(todayIso).getTime()) / 864e5 <= 7);
  // Was gerade zählt: Set heute, neue Platten zum Beschriften, sonst der Überblick
  // Beim ersten Laden steht die große Karte da, die kleine Anzeige unten wäre doppelt
  useRootClass("home-loading", busy && !stats?.records);
  const statusLine = !stats
    ? ""
    : setToday
      ? `Set „${stats.nextSet!.name}“ · ${stats.nextSet!.trackIds.length} Tracks eingepackt?`
      : stats.records === 0
        ? "Deine Kiste wird gerade gefüllt"
        : [`${stats.records} Platten`, `${stats.wants} Wants`, stats.noSticker ? `${stats.noSticker} ohne Einleger` : null].filter(Boolean).join(" · ");

  return (
    <>

      {/* Erster Bildschirm: Begrüßung, Diggen, Zuletzt hinzugefügt. Der Rest kommt beim Scrollen. */}
      <div className="home-first">
      <header className="home-hero">
        <div className="home-hero-bg" aria-hidden="true">
          {(stats?.recent ?? []).filter(Boolean).slice(0, 4).map((r) => r && <img key={r.id} src={r.cover || r.thumb} alt="" />)}
        </div>
        <div className="home-hero-top">
          <div className="eyebrow">{today}</div>
          <div className="home-hero-actions">
<Link to="/search" viewTransition className="hero-btn press" aria-label="Platte suchen">
              <IconSearch />
            </Link>
            <Link to="/settings" viewTransition className="hero-avatar press" aria-label="Profil und Einstellungen">
              <Avatar src={profile?.avatar} name={me?.username ?? "?"} size={56} />
            </Link>
          </div>
        </div>
        <h1>{greeting(firstName, { setToday })}</h1>
        <p className="home-hero-status">{statusLine}</p>
      </header>

      <div className="page home-first-body">
        {/* Große Fortschritts-Karte nur beim ersten Laden; danach reicht die kleine Anzeige unten */}
        {busy && !stats?.records && (
          <div className="card progress-card" style={{ marginBottom: 12, animation: "pop .5s var(--spring) both" }} aria-live="polite">
            <span className="spin" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Deine Sammlung kommt von Discogs</b>
              <SyncStatus why={false} />
              <div className="tiny" style={{ marginTop: 8 }}>Läuft im Hintergrund weiter, du kannst die App normal benutzen.</div>
            </div>
          </div>
        )}
        {apkOutdated() && (
          <Hint id={`apk-${LATEST_APK}`}>
            <b>Neue Version der Android-App.</b> Sie holt Mitteilungen zuverlässig im Hintergrund ab.{" "}
            {canSelfUpdate() ? (
              <>
                Ein Tipp genügt, deine Daten bleiben.{" "}
                <button className="link-btn" onClick={updateApp}>
                  Jetzt aktualisieren
                </button>
              </>
            ) : (
              <>
                Ab dieser Version aktualisiert sich die App künftig selbst, ein letztes Mal brauchst du die Datei.{" "}
                <a href={`/download/crate.apk?v=${LATEST_APK}`} download={`crate-${apkName(LATEST_APK)}.apk`}>
                  Version {apkName(LATEST_APK)} laden und installieren
                </a>
              </>
            )}
          </Hint>
        )}
        {nativePush() && !nativeToken() && (
          <Hint id="native-push">
            <b>Mitteilungen laufen jetzt in der App.</b> Einmal einschalten, dann meldet sich Crate bei Wants, Freunden und Gigs.{" "}
            <Link to="/settings/notifications" viewTransition>Zu den Mitteilungen</Link>
          </Hint>
        )}
        {stylus?.wear != null && stylus.wear >= 0.9 && (
          <Link to="/settings/stylus" viewTransition className="hint" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="hint-text">
              <b>Nadel bald wechseln.</b> {hoursText(stylus.minutes)} seit dem letzten Wechsel, {Math.round(stylus.wear * 100)} % der Lebensdauer.
            </span>
            <span className="chev">›</span>
          </Link>
        )}
        {stats && stats.records === 0 && !busy ? (
          <Empty title="Deine Kiste ist noch leer" action={<button className="btn primary" onClick={sync}>Sammlung von Discogs laden</button>}>
            Wir holen Sammlung und Wantlist von Discogs. Danach geht alles auch offline.
          </Empty>
        ) : (
          <>
            {(social?.in.length ?? 0) > 0 && (
              <Link to="/friends" viewTransition className="card row press friend-nudge">
                <IconUser />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{social!.in.length === 1 ? `${social!.in[0].from} möchte mit dir befreundet sein` : `${social!.in.length} Freundschaftsanfragen`}</b>
                  <span className="sub" style={{ display: "block" }}>Antippen zum Annehmen</span>
                </span>
                <span className="chev">›</span>
              </Link>
            )}
            {/* Gig in den nächsten 7 Tagen: ganz nach oben, wie ein Flyer an der Wand */}
            {stats?.nextSet && gigSoon && <GigCard set={stats.nextSet} covers={stats.gigCovers} records={stats.gigRecords} />}
            {buzz.unread > 0 && (
              <Link to="/friends" viewTransition className="card row press friend-nudge">
                <IconUser />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{buzz.unread === 1 ? "Eine Neuigkeit von deinen Freunden" : `${buzz.unread} Neuigkeiten von deinen Freunden`}</b>
                  <span className="sub" style={{ display: "block" }}>
                    {buzz.inbox[0] ? `${buzz.inbox[0].from} ${buzz.inbox[0].kind === "react" ? "gefällt deine Platte" : buzz.inbox[0].kind === "comment" ? "hat kommentiert" : "empfiehlt dir eine Platte"}` : "Antippen zum Ansehen"}
                  </span>
                </span>
                <span className="chev">›</span>
              </Link>
            )}
            {(buzz.dm ?? 0) > 0 && (
              <Link to="/friends" viewTransition className="card row press friend-nudge">
                <IconChat />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{buzz.dm === 1 ? "Eine neue Nachricht" : `${buzz.dm} neue Nachrichten`}</b>
                  <span className="sub" style={{ display: "block" }}>Von deinen Freunden</span>
                </span>
                <span className="chev">›</span>
              </Link>
            )}
            <Link to="/dig" viewTransition className="dig-entry press rise" onClick={() => haptic(10)}>
              <span className="covers">
                {(stats?.recent ?? []).filter(Boolean).slice(0, 4).map((r) => r && (
                  <img key={r.id} src={r.cover || r.thumb} alt="" />
                ))}
              </span>
              <span>
                <b>Jetzt diggen</b>
                <small>Neues aus deinen Labels und Styles, mit Hörprobe</small>
              </span>
              <span className="go">
                <IconPlay />
              </span>
            </Link>
            {/* Werkzeug: gleich unter dem Diggen, damit es nicht untergeht (Franz: „gehen etwas unter“) */}
            <nav className="tools" aria-label="Werkzeug">
              {TOOLS.map((t) => (
                <Link key={t.to} to={t.to} viewTransition className="tool press" onClick={() => haptic(8)}>
                  <span className="tool-ico">
                    {t.icon}
                    {t.to === "/stickers" && stats?.noSticker ? <span className="tool-count">{stats.noSticker > 99 ? "99+" : stats.noSticker}</span> : null}
                  </span>
                  <span className="tool-label">{t.label}</span>
                </Link>
              ))}
            </nav>
            <DailyRecord />
            {stats?.recent.length ? (
              <>
                {/* Schaufenster: die neuesten Platten als Cover-Wand, die jüngste groß */}
                <div className="row home-wall-head">
                  <h2>Neu in der Kiste</h2>
                  <span className="spacer" />
                  <Link to="/collection" viewTransition className="btn small ghost" style={{ paddingRight: 0 }}>
                    Alle
                  </Link>
                </div>
                <div className="home-wall rise">
                  {stats.recent.slice(0, 9).map((r, i) => (
                    <Link
                      key={r!.id}
                      to={`/release/${r!.id}`}
                      viewTransition
                      state={{ preview: { thumb: r!.thumb, cover: r!.cover, title: r!.title, artist: r!.artist } }}
                      onClick={(e) => markHero(e.currentTarget)}
                      className={`press${i === 0 ? " big" : ""}`}
                      aria-label={`${r!.title} von ${r!.artist}`}
                    >
                      <Cover src={i === 0 ? r!.cover || r!.thumb : r!.thumb || r!.cover} />
                      {i === 0 && (
                        <span className="wall-tag">
                          <b>{r!.title}</b>
                          <span>{r!.artist}</span>
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
      </div>

      <div className="page home-rest">
        {!(stats && stats.records === 0 && !busy) && (
          <>
            {/* Nächster Gig: so präsent wie ein Flyer an der Wand */}
            {stats?.nextSet && !gigSoon && <GigCard set={stats.nextSet} covers={stats.gigCovers} records={stats.gigRecords} />}
            {/* Jahresrückblick: ab 1. Dezember Vorfreude, ab dem 15. offen, bis Ende Januar */}
            {season && (
              <Link to="/year" viewTransition className={`year-entry press${season.state === "soon" ? " soon" : ""}`}>
                <span className="eyebrow">Dein Jahr auf Platte</span>
                <b>{season.state === "soon" ? (season.days === 1 ? "Morgen ist es da" : `Noch ${season.days} Tage`) : `Rückblick ${season.year}`}</b>
                <span className="chev">›</span>
              </Link>
            )}
            <FriendsHome friends={stats?.friends ?? []} limit={3} />

            <DjOverview compact />

            <Link to="/guide" viewTransition className="guide-entry press">
              <span className="guide-tip-ico">
                <IconInfo />
              </span>
              <span className="guide-tip-main">
                <b>Gut zu wissen</b>
                <span className="sub">Platten pflegen, Nadel, Boxen, Mixer und worauf Einsteiger achten</span>
              </span>
              <span className="chev">›</span>
            </Link>
          </>
        )}
        {stats?.lastSync ? <p className="tiny" style={{ textAlign: "center", marginTop: 24 }}>Zuletzt synchronisiert {new Date(stats.lastSync).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
      </div>
    </>
  );
}

function GigCard({ set, covers, records }: { set: DJSet; covers: string[]; records: number }) {
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const days = Math.round((new Date(set.date!).getTime() - today) / 86_400_000);
  const when = days <= 0 ? "Heute" : days === 1 ? "Morgen" : days < 14 ? `In ${days} Tagen` : new Date(set.date!).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
  const date = new Date(set.date!).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  return (
    <Link to={`/sets/${set.id}`} viewTransition className="gig-card press">
      <span className={`set-wall n${Math.min(covers.length, 4)}`}>
        {covers.slice(0, 4).map((src, i) => (
          <img key={i} src={src} alt="" loading="lazy" decoding="async" />
        ))}
        {covers.length === 0 && <span className="set-count">Noch leer</span>}
      </span>
      <span className="gig-text">
        <span className="wall-tag inline">{when}</span>
        <b>{set.name || "Gig"}</b>
        <span className="sub">{[set.venue, date, set.start ? `${set.start} Uhr` : null].filter(Boolean).join(" · ")}</span>
        <span className="sub">{set.trackIds.length} Tracks · {records} {records === 1 ? "Platte" : "Platten"}</span>
      </span>
    </Link>
  );
}
