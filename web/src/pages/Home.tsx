import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV } from "../lib/db";
import { autoPipeline } from "../lib/sync";
import { toast, useStore } from "../lib/store";
import { Cover, Empty, haptic, markHero, Ring } from "../components/bits";
import { IconCamera, IconCart, IconGear, IconList, IconSync, IconTag } from "../components/icons";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 17 ? "Hallo" : "Guten Abend";
};

export default function Home() {
  const me = useStore((s) => s.me);
  const jobs = useStore((s) => s.jobs);
  const busy = Object.keys(jobs).length > 0;

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
    };
  });


  const sync = async () => {
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
      <div className="page-head">
        <div>
          <div className="eyebrow">{today}</div>
          <h1>
            {greeting()}, {me?.username}
          </h1>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn round" onClick={sync} disabled={busy} aria-label="Synchronisieren">
            <span style={{ display: "grid", animation: busy ? "spin 1s linear infinite" : undefined }}>
              <IconSync />
            </span>
          </button>
          <Link to="/settings" viewTransition className="icon-btn round" aria-label="Einstellungen">
            <IconGear />
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

            {stats && stats.tracks > 0 && (
              <>
                <h2>DJ-Daten</h2>
                <Link to="/settings" viewTransition className="card row press" style={{ justifyContent: "space-around", padding: "18px 12px" }}>
                  {[
                    ["BPM", stats.withBpm, "var(--accent)"],
                    ["Key", stats.withKey, "#a99cf9"],
                    ["Vibe", stats.withEnergy, "#30d158"],
                  ].map(([l, v, c]) => (
                    <div key={l as string} className="stack" style={{ alignItems: "center", gap: 8 }}>
                      <Ring value={v as number} max={stats.tracks} color={c as string}>
                        {Math.round((100 * (v as number)) / stats.tracks)}%
                      </Ring>
                      <span className="sub" style={{ fontSize: 13 }}>
                        {l}
                      </span>
                    </div>
                  ))}
                </Link>
                <p className="tiny" style={{ textAlign: "center" }}>
                  {stats.tracks} Tracks · Tippen zum Ergänzen
                </p>
              </>
            )}
          </>
        )}
        {stats?.lastSync ? <p className="tiny" style={{ textAlign: "center", marginTop: 24 }}>Zuletzt synchronisiert {new Date(stats.lastSync).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
      </div>
    </>
  );
}
