import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV } from "../lib/db";
import { fullSync, fetchMissingDetails, syncWants } from "../lib/sync";
import { toast, useStore } from "../lib/store";
import { Cover } from "../components/bits";
import { IconCamera, IconCart, IconGear, IconSync, IconTag } from "../components/icons";

export default function Home() {
  const me = useStore((s) => s.me);
  const jobs = useStore((s) => s.jobs);
  const busy = Object.keys(jobs).length > 0;

  const stats = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const metas = await db.recordMeta.bulkGet(ids);
    const tracks = await db.tracks.toArray();
    const inColl = new Set(ids);
    const myTracks = tracks.filter((t) => inColl.has(t.releaseId));
    const recent = [...coll].sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 9);
    return {
      records: ids.length,
      wants: await db.wants.count(),
      tracks: myTracks.length,
      withBpm: myTracks.filter((t) => t.bpm).length,
      withKey: myTracks.filter((t) => t.key).length,
      noSticker: ids.filter((_, i) => !metas[i]?.stickerPrintedAt).length,
      sets: await db.sets.count(),
      recent: (await db.releases.bulkGet(recent.map((r) => r.releaseId))).filter(Boolean),
      lastSync: await getKV<number>("lastCollectionSync", 0),
    };
  });

  // Beim ersten Start automatisch synchronisieren, danach höchstens alle 6 Stunden
  useEffect(() => {
    if (!stats || busy) return;
    if (Date.now() - stats.lastSync > 6 * 3600_000) {
      fullSync().catch((e) => toast(`Sync fehlgeschlagen: ${e.message}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.lastSync]);

  const sync = async () => {
    try {
      await fullSync();
      toast("Sync abgeschlossen");
    } catch (e) {
      toast(`Sync fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hi {me?.username}</h1>
          <div className="sub">{stats?.lastSync ? `Zuletzt synchronisiert: ${new Date(stats.lastSync).toLocaleString("de-DE")}` : "Noch nicht synchronisiert"}</div>
        </div>
        <Link to="/settings" className="icon-btn" aria-label="Einstellungen">
          <IconGear />
        </Link>
      </div>
      <div className="page">
        <div className="grid3">
          <Link to="/collection" className="stat">
            <b>{stats?.records ?? "–"}</b>
            <span>Platten</span>
          </Link>
          <Link to="/wants" className="stat">
            <b>{stats?.wants ?? "–"}</b>
            <span>Wants</span>
          </Link>
          <Link to="/sets" className="stat">
            <b>{stats?.sets ?? "–"}</b>
            <span>Sets</span>
          </Link>
        </div>

        <h2>Schnellzugriff</h2>
        <div className="grid2">
          <Link to="/scan" className="card row">
            <IconCamera /> Platte scannen
          </Link>
          <Link to="/shop" className="card row">
            <IconCart /> Händler-Optimierer
          </Link>
          <Link to="/stickers" className="card row">
            <IconTag /> Sticker {stats?.noSticker ? <span className="badge accent">{stats.noSticker} neu</span> : null}
          </Link>
          <button className="card row" onClick={sync} disabled={busy} style={{ textAlign: "left" }}>
            <IconSync /> {busy ? "Läuft …" : "Jetzt syncen"}
          </button>
        </div>

        {stats && stats.tracks > 0 && (
          <>
            <h2>DJ-Daten</h2>
            <div className="card stack">
              <div className="row">
                <span>Tracks mit BPM</span>
                <span className="spacer" />
                <b>
                  {stats.withBpm}/{stats.tracks}
                </b>
              </div>
              <div className="progress">
                <div style={{ width: `${(100 * stats.withBpm) / stats.tracks}%` }} />
              </div>
              <div className="row">
                <span>Tracks mit Key</span>
                <span className="spacer" />
                <b>
                  {stats.withKey}/{stats.tracks}
                </b>
              </div>
              <div className="progress">
                <div style={{ width: `${(100 * stats.withKey) / stats.tracks}%` }} />
              </div>
              <Link to="/settings" className="sub">
                BPM, Key und Vibes automatisch ergänzen →
              </Link>
            </div>
          </>
        )}

        {stats && stats.records === 0 && !busy && (
          <div className="card" style={{ marginTop: 16 }}>
            Noch keine Platten geladen.{" "}
            <button className="btn small primary" onClick={sync}>
              Sammlung laden
            </button>
          </div>
        )}

        {stats?.recent.length ? (
          <>
            <h2>Zuletzt hinzugefügt</h2>
            <div className="cover-grid">
              {stats.recent.map((r) => (
                <Link key={r!.id} to={`/release/${r!.id}`}>
                  <Cover src={r!.cover || r!.thumb} />
                </Link>
              ))}
            </div>
          </>
        ) : null}

        <div className="row wrap" style={{ marginTop: 22 }}>
          <button className="btn small ghost" onClick={() => syncWants().catch((e) => toast(e.message))}>
            Nur Wantlist syncen
          </button>
          <button className="btn small ghost" onClick={() => fetchMissingDetails("collection").catch((e) => toast(e.message))}>
            Fehlende Tracklists laden
          </button>
        </div>
      </div>
    </>
  );
}
