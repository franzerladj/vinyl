import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, type DJSet } from "../lib/db";
import { cachedSocial } from "../lib/social";
import { FriendsHome } from "../components/FriendsHome";
import { friendMatches, type MyProfile } from "../lib/friends";
import { autoPipeline, isPipelineRunning } from "../lib/sync";
import { toast, useStore } from "../lib/store";
import { Avatar, Cover, Empty, haptic, markHero } from "../components/bits";
import { DjOverview } from "../components/DjOverview";
import { computeStylus, hoursText } from "../lib/stylus";
import { IconCamera, IconCart, IconList, IconPlay, IconSearch, IconSync, IconTag, IconUser } from "../components/icons";

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

export default function Home() {
  const stylus = useLiveQuery(() => computeStylus(), []);
  const me = useStore((s) => s.me);
  const jobs = useStore((s) => s.jobs);
  const busy = Object.keys(jobs).length > 0;

  const profile = useLiveQuery(() => getKV<MyProfile | null>("myProfile", null));
  const social = useLiveQuery(() => cachedSocial(), []);
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


  // Herunterziehen am Seitenanfang startet den Sync (die Seite selbst wird nicht neu geladen)
  const [pull, setPull] = useState(0);
  useEffect(() => {
    let startY: number | null = null;
    let dy = 0;
    const down = (e: TouchEvent) => {
      startY = window.scrollY <= 0 ? e.touches[0].clientY : null;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY == null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      setPull(Math.min(1.2, dy / 110));
    };
    const up = () => {
      if (startY != null && dy > 110) void sync();
      startY = null;
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Was gerade zählt: Set heute, neue Platten zum Beschriften, sonst der Überblick
  const statusLine = !stats
    ? ""
    : setToday
      ? `Set „${stats.nextSet!.name}“ · ${stats.nextSet!.trackIds.length} Tracks eingepackt?`
      : stats.records === 0
        ? "Deine Kiste wird gerade gefüllt"
        : [`${stats.records} Platten`, `${stats.wants} Wants`, stats.noSticker ? `${stats.noSticker} ohne Einleger` : null].filter(Boolean).join(" · ");

  return (
    <>
      {pull > 0.05 && (
        <div className="ptr" style={{ opacity: Math.min(1, pull), transform: `translateY(${pull * 40}px) rotate(${pull * 300}deg)` }} aria-hidden="true">
          <IconSync />
        </div>
      )}
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
              <b>{stats?.records ? "Crate bringt alles auf den neuesten Stand" : "Deine Sammlung wird geladen"}</b>
              {Object.values(jobs).map((j) => (
                <div key={j.id} style={{ marginTop: 8 }}>
                  <div className="row sub" style={{ fontSize: 13 }}>
                    <span>{j.label}</span>
                    <span className="spacer" />
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {j.done}/{j.total || "?"}
                    </span>
                  </div>
                  <div className="progress" style={{ height: 4, marginTop: 4 }}>
                    <div style={{ width: `${j.total ? (100 * j.done) / j.total : 4}%` }} />
                  </div>
                </div>
              ))}
              <div className="tiny" style={{ marginTop: 8 }}>Läuft im Hintergrund weiter, du kannst die App normal benutzen.</div>
            </div>
          </div>
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
            {stats?.nextSet && <GigCard set={stats.nextSet} covers={stats.gigCovers} records={stats.gigRecords} />}
            {/* Ab November bis Januar: Jahresrückblick anbieten */}
            {[10, 11, 0].includes(new Date().getMonth()) && (
              <Link to="/year" viewTransition className="year-entry press">
                <span className="eyebrow">Dein Jahr auf Platte</span>
                <b>Rückblick {new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear()}</b>
                <span className="chev">›</span>
              </Link>
            )}
            <FriendsHome friends={stats?.friends ?? []} limit={3} />

            <DjOverview compact />

            <h2 style={{ marginTop: 28 }}>Werkzeug</h2>
            <div className="grid2" >
              <Link to="/scan" viewTransition className="widget">
                <div className="ico">
                  <IconCamera />
                </div>
                <b>Platte scannen</b>
                <span className="sub">Foto, Barcode oder Katalognr.</span>
              </Link>
              <Link to="/shop" viewTransition className="widget">
                <div className="ico">
                  <IconCart />
                </div>
                <b>Versand sparen</b>
                <span className="sub">{stats?.listings ? `${stats.listings} Angebote geladen` : "Händler-Optimierer"}</span>
              </Link>
              <Link to="/stickers" viewTransition className="widget">
                <div className="ico">
                  <IconTag />
                </div>
                {stats?.noSticker ? <span className="badge accent count">{stats.noSticker} neu</span> : null}
                <b>Sticker & Einleger</b>
                <span className="sub">{stats?.noSticker ? `${stats.noSticker} Platten warten` : "Alles beschriftet"}</span>
              </Link>
              <Link to="/sets/new" viewTransition className="widget">
                <div className="ico">
                  <IconList />
                </div>
                <b>Neues Set</b>
                <span className="sub">Aus deiner Kiste</span>
              </Link>
            </div>
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
