import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV } from "../lib/db";
import { friendMatches, type MyProfile } from "../lib/friends";
import { autoPipeline, isPipelineRunning } from "../lib/sync";
import { toast, useStore } from "../lib/store";
import { Avatar, Cover, Empty, haptic, markHero } from "../components/bits";
import { DjOverview } from "../components/DjOverview";
import { IconCamera, IconCart, IconList, IconPlay, IconSync, IconTag } from "../components/icons";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 17 ? "Hallo" : "Guten Abend";
};

export default function Home() {
  const me = useStore((s) => s.me);
  const jobs = useStore((s) => s.jobs);
  const busy = Object.keys(jobs).length > 0;

  const profile = useLiveQuery(() => getKV<MyProfile | null>("myProfile", null));
  const stats = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const [metas, tracks] = await Promise.all([db.recordMeta.bulkGet(ids), db.tracks.where("releaseId").anyOf(ids).toArray()]);
    const recent = [...coll].sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 12);
    const nextSet = (await db.sets.toArray()).filter((s) => s.date && s.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date!.localeCompare(b.date!))[0];
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
      toast("Alles synchron und analysiert");
    } catch (e) {
      toast(`Sync fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const today = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      {pull > 0.05 && (
        <div className="ptr" style={{ opacity: Math.min(1, pull), transform: `translateY(${pull * 40}px) rotate(${pull * 300}deg)` }} aria-hidden="true">
          <IconSync />
        </div>
      )}
      <div className="page-head">
        <div>
          <div className="eyebrow">{today}</div>
          <h1>
            {greeting()}, {profile?.name?.split(" ")[0] || me?.username}
          </h1>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn round" onClick={sync} disabled={busy} aria-label="Synchronisieren">
            <span style={{ display: "grid", animation: busy ? "spin 1s linear infinite" : undefined }}>
              <IconSync />
            </span>
          </button>
          <Link to="/settings" viewTransition className="press" aria-label="Profil und Einstellungen" style={{ display: "grid", borderRadius: "50%", boxShadow: "0 0 0 2px var(--surface-2)" }}>
            <Avatar src={profile?.avatar} name={me?.username ?? "?"} size={38} />
          </Link>
        </div>
      </div>

      <div className="page">
        {busy && (
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
        {stats && stats.records === 0 && !busy ? (
          <Empty title="Deine Kiste ist noch leer" action={<button className="btn primary" onClick={sync}>Sammlung von Discogs laden</button>}>
            Wir holen Sammlung und Wantlist von Discogs. Danach geht alles auch offline.
          </Empty>
        ) : (
          <>
            <Link to="/dig" viewTransition className="dig-entry press rise" onClick={() => haptic(10)}>
              <span className="covers">
                {(stats?.recent ?? []).filter(Boolean).slice(0, 4).map((r) => r && (
                  <img key={r.id} src={r.cover || r.thumb} alt="" />
                ))}
              </span>
              <span>
                <b>Jetzt diggen</b>
                <small>Neue Platten passend zu deiner Kiste, mit Hörprobe</small>
              </span>
              <span className="go">
                <IconPlay />
              </span>
            </Link>
            {stats?.recent.length ? (
              <>
                <h2 style={{ marginTop: 12 }}>Neu in der Kiste</h2>
                <div className="carousel rise">
                  {stats.recent.map((r) => (
                    <Link
                      key={r!.id}
                      to={`/release/${r!.id}`}
                      viewTransition
                      state={{ preview: { thumb: r!.thumb, cover: r!.cover, title: r!.title, artist: r!.artist } }}
                      onClick={(e) => markHero(e.currentTarget)}
                      className="press"
                    >
                      <Cover src={r!.cover || r!.thumb} />
                      <div className="t">{r!.title}</div>
                      <div className="a">{r!.artist}</div>
                    </Link>
                  ))}
                </div>
              </>
            ) : null}

            <div className="grid3">
              <Link to="/collection" viewTransition className="stat">
                <b>{stats?.records ?? "–"}</b>
                <span>Platten</span>
              </Link>
              <Link to="/wants" viewTransition className="stat">
                <b>{stats?.wants ?? "–"}</b>
                <span>Wants</span>
              </Link>
              <Link to="/sets" viewTransition className="stat">
                <b>{stats?.sets ?? "–"}</b>
                <span>Sets</span>
              </Link>
            </div>

            <div className="grid2" style={{ marginTop: 10 }}>
              <Link to="/scan" viewTransition className="widget">
                <div className="ico" style={{ background: "linear-gradient(135deg,#ff9a3c,#ff5e1a)" }}>
                  <IconCamera />
                </div>
                <b>Platte scannen</b>
                <span className="sub">Foto, Barcode oder Katalognr.</span>
              </Link>
              <Link to="/shop" viewTransition className="widget">
                <div className="ico" style={{ background: "linear-gradient(135deg,#3ee07a,#16a34a)" }}>
                  <IconCart />
                </div>
                <b>Versand sparen</b>
                <span className="sub">{stats?.listings ? `${stats.listings} Angebote geladen` : "Händler-Optimierer"}</span>
              </Link>
              <Link to="/stickers" viewTransition className="widget">
                <div className="ico" style={{ background: "linear-gradient(135deg,#c084fc,#7c3aed)" }}>
                  <IconTag />
                </div>
                {stats?.noSticker ? <span className="badge accent count">{stats.noSticker} neu</span> : null}
                <b>Sticker & Einleger</b>
                <span className="sub">{stats?.noSticker ? `${stats.noSticker} Platten warten` : "Alles beschriftet"}</span>
              </Link>
              <Link to={stats?.nextSet ? `/sets/${stats.nextSet.id}` : "/sets/new"} viewTransition className="widget">
                <div className="ico" style={{ background: "linear-gradient(135deg,#60a5fa,#2563eb)" }}>
                  <IconList />
                </div>
                <b>{stats?.nextSet ? stats.nextSet.name : "Set planen"}</b>
                <span className="sub">
                  {stats?.nextSet ? `${new Date(stats.nextSet.date!).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })} · ${stats.nextSet.trackIds.length} Tracks` : "Nach BPM, Key und Vibe"}
                </span>
              </Link>
            </div>

            <div className="row" style={{ marginTop: 28, marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Freunde</h2>
              <span className="spacer" />
              <Link to="/friends" viewTransition className="btn small ghost" style={{ paddingRight: 0 }}>
                Alle
              </Link>
            </div>
            <div className="carousel" style={{ paddingBottom: 6 }}>
              {(stats?.friends ?? []).map(({ f, m }) => (
                <Link key={f.username} to={`/friends/${encodeURIComponent(f.username)}`} viewTransition className="press" style={{ width: 84, textAlign: "center", position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <Avatar src={f.avatar} name={f.username} size={72} />
                  </div>
                  {m.hasYourWants.length > 0 && (
                    <span className="badge" style={{ position: "absolute", top: 0, right: 2, background: "var(--ok)", color: "#fff" }}>
                      {m.hasYourWants.length}
                    </span>
                  )}
                  <div className="t" style={{ fontSize: 13 }}>{f.username}</div>
                </Link>
              ))}
              <Link to="/friends" viewTransition className="press" style={{ width: 84, textAlign: "center" }}>
                <span style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto", display: "grid", placeItems: "center", border: "1.5px dashed var(--surface-3)", color: "var(--accent)", fontSize: 28 }}>+</span>
                <div className="t" style={{ fontSize: 13, color: "var(--text-2)" }}>{stats?.friends.length ? "Hinzufügen" : "Freunde"}</div>
              </Link>
            </div>
            {stats && stats.friends.some((x) => x.m.hasYourWants.length) && (
              <p className="tiny" style={{ marginTop: 0 }}>
                Grüne Zahl: so viele deiner Wants stehen bei diesem Freund im Regal.
              </p>
            )}

            <DjOverview />
          </>
        )}
        {stats?.lastSync ? <p className="tiny" style={{ textAlign: "center", marginTop: 24 }}>Zuletzt synchronisiert {new Date(stats.lastSync).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
      </div>
    </>
  );
}
