// Jahresrückblick: dein Jahr auf Platte, mit Story-Karte zum Teilen
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NavBar } from "../components/ui";
import { Cover, Empty, keepParens, SkeletonRows } from "../components/bits";
import { ShareCardSheet } from "../components/ShareCard";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { renderYearCard } from "../lib/shareCard";
import { durationSeconds } from "../../../shared/stylus";
import { yearReview } from "../../../shared/year";

/** Im Januar zeigt der Rückblick noch das Vorjahr */
export const reviewYear = (d = new Date()) => (d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear());

export default function YearPage() {
  const year = Number(useParams().year) || reviewYear();
  const me = useStore((s) => s.me);
  const [sharing, setSharing] = useState(false);
  const data = useLiveQuery(async () => {
    const [collection, sets, tracks] = await Promise.all([db.collection.toArray(), db.sets.toArray(), db.tracks.toArray()]);
    const ids = [...new Set([...collection.map((c) => c.releaseId), ...tracks.map((t) => t.releaseId)])];
    const rels = (await db.releases.bulkGet(ids)).filter(Boolean);
    const releases = new Map(rels.map((r) => [r!.id, r!]));
    const tm = new Map(tracks.map((t) => [t.id, t]));
    return yearReview({
      year,
      collection,
      releases,
      sets,
      trackRelease: (id) => tm.get(id)?.releaseId,
      trackSeconds: (id) => {
        const t = tm.get(id);
        return t ? durationSeconds(releases.get(t.releaseId)?.tracklist?.find((x) => x.position === t.position)?.duration) : null;
      },
    });
  }, [year]);
  const card = useMemo(
    () =>
      data && {
        year,
        username: me?.username ?? "",
        added: data.added,
        sets: data.sets,
        hours: data.hours,
        covers: data.addedCovers.map((r) => r.cover || r.thumb),
        mostPlayed: data.mostPlayed.map((m) => ({ title: m.release!.title, artist: m.release!.artist, n: m.n })),
        newest: data.addedCovers.map((r) => ({ title: r.title, artist: r.artist })),
        label: data.topLabels[0]?.name,
        style: data.topStyles[0]?.name,
      },
    [data, year, me?.username],
  );
  return (
    <>
      <NavBar title={`Rückblick ${year}`} titleOnScroll />
      <div className="page stack year">
        <div>
          <span className="eyebrow">Dein Jahr auf Platte</span>
          <h1 className="year-big">{year}</h1>
        </div>
        {!data && <SkeletonRows n={4} />}
        {data && data.added === 0 && data.sets === 0 ? (
          <Empty title="Noch nicht viel passiert">Sobald du in diesem Jahr Platten hinzufügst oder Sets spielst, steht hier dein Rückblick.</Empty>
        ) : data ? (
          <>
            <div className="grid3">
              <div className="stat">
                <b>{data.added}</b>
                <span>{data.added === 1 ? "neue Platte" : "neue Platten"}</span>
              </div>
              <div className="stat">
                <b>{data.sets}</b>
                <span>{data.sets === 1 ? "Set gespielt" : "Sets gespielt"}</span>
              </div>
              <div className="stat">
                <b>{data.hours}</b>
                <span>Stunden aufgelegt</span>
              </div>
            </div>
            {data.addedCovers.length > 0 && (
              <div className="year-fan" aria-hidden>
                {data.addedCovers.slice(0, 5).map((r) => (
                  <Cover key={r.id} src={r.cover || r.thumb} />
                ))}
              </div>
            )}
            {data.mostPlayed.length > 0 && (
              <>
                <h2 style={{ marginBottom: 0 }}>Am häufigsten gespielt</h2>
                <div className="list">
                  {data.mostPlayed.map(({ release: r, n }, i) => (
                    <Link key={r!.id} to={`/release/${r!.id}`} viewTransition className="rec" style={{ color: "inherit" }}>
                      <span className="shared-num">{i + 1}</span>
                      <Cover src={r!.thumb} />
                      <div className="rec-main">
                        <div className="rec-title">{keepParens(r!.title)}</div>
                        <div className="rec-artist">{r!.artist}</div>
                      </div>
                      <span className="badge">{n}×</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
            <div className="card stack" style={{ gap: 6 }}>
              {data.topLabels[0] && (
                <span>
                  Label des Jahres: <b>{data.topLabels[0].name}</b> <span className="sub">({data.topLabels[0].n} neue Platten)</span>
                </span>
              )}
              {data.topStyles[0] && (
                <span>
                  Style des Jahres: <b>{data.topStyles[0].name}</b>
                </span>
              )}
              {data.venues > 0 && (
                <span>
                  Aufgelegt an <b>{data.venues}</b> {data.venues === 1 ? "Ort" : "Orten"}
                </span>
              )}
              {data.oldest && (
                <span>
                  Älteste Neuzugang: <b>{data.oldest.title}</b> <span className="sub">({data.oldest.year})</span>
                </span>
              )}
            </div>
            <button className="btn primary block lg" onClick={() => setSharing(true)}>
              Als Story teilen
            </button>
            {card && (
              <ShareCardSheet open={sharing} onClose={() => setSharing(false)} title={`Dein Jahr ${year}`} filename={`crate-${year}.png`} text={`Mein Jahr auf Platte ${year}`} make={() => renderYearCard(card)} />
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
