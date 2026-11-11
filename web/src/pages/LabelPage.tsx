// Label vervollständigen: was hast du, was fehlt dir noch?
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NavBar } from "../components/ui";
import { Cover, Empty, haptic, Seg, SkeletonRows } from "../components/bits";
import { db } from "../lib/db";
import { addWant } from "../lib/sync";
import { toast } from "../lib/store";
import { loadLabel, type LabelData } from "../lib/labels";
import { labelCompletion, normCatno } from "../../../shared/labels";

export default function LabelPage() {
  const id = Number(useParams().id);
  const [data, setData] = useState<LabelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"missing" | "all">("missing");
  useEffect(() => {
    setData(null);
    loadLabel(id).then(setData, (e: Error) => setError(e.message));
  }, [id]);
  const mine = useLiveQuery(async () => {
    const [coll, wants] = await Promise.all([db.collection.toArray(), db.wants.toArray()]);
    const owned = new Set(coll.map((c) => c.releaseId));
    const rels = await db.releases.bulkGet([...owned]);
    const catnos = new Set(rels.flatMap((r) => (r?.labels ?? []).filter((l) => l.id === id).map((l) => normCatno(l.catno))));
    return { owned, wanted: new Set(wants.map((w) => w.releaseId)), catnos };
  }, [id]);
  const c = useMemo(() => (data && mine ? labelCompletion(data.releases, mine.owned, mine.wanted, mine.catnos) : null), [data, mine]);

  const want = async (rid: number) => {
    try {
      await addWant(rid);
      haptic(8);
      toast("Auf die Wantlist gesetzt");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const list = c ? (view === "missing" ? c.missing : c.entries) : [];
  return (
    <>
      <NavBar title={data?.name.replace(/\s\(\d+\)$/, "") ?? "Label"} titleOnScroll />
      <div className="page stack">
        <div className="page-head" style={{ padding: 0 }}>
          <div>
            <span className="eyebrow">Label</span>
            <h1 style={{ whiteSpace: "normal" }}>{data?.name.replace(/\s\(\d+\)$/, "") ?? " "}</h1>
          </div>
        </div>
        {error && <Empty title="Label nicht geladen">{error}</Empty>}
        {!data && !error && <SkeletonRows n={6} />}
        {c && (
          <>
            <div className="card stack" style={{ gap: 8 }}>
              <div className="shared-meter" aria-hidden>
                <span style={{ width: `${c.total ? (c.have / c.total) * 100 : 0}%` }} />
              </div>
              <b>
                Du hast {c.have} von {c.total} Platten
              </b>
              <span className="sub">
                {c.missing.length === 0 ? "Komplett. Respekt." : `${c.missing.length} fehlen dir noch. Gezählt wird jede Katalognummer auf Vinyl einmal, egal welche Pressung du hast.`}
                {data!.truncated && ` Großes Label: berücksichtigt sind die ersten ${data!.releases.length} von ${data!.items} Einträgen.`}
              </span>
            </div>
            <Seg value={view} options={[["missing", `Fehlen (${c.missing.length})`], ["all", `Alle (${c.total})`]]} onChange={setView} />
            <div className="list">
              {list.map((e) => (
                <div key={e.catno + e.main.id} className="rec">
                  <Cover src={e.main.thumb} />
                  <Link to={`/release/${e.main.id}`} viewTransition className="rec-main" style={{ color: "inherit" }}>
                    <div className="rec-title">{e.main.title}</div>
                    <div className="rec-artist">{e.main.artist}</div>
                    <div className="rec-meta">
                      <span className="mono">{e.catno}</span>
                      {e.main.year ? <span>{e.main.year}</span> : null}
                    </div>
                  </Link>
                  {e.have ? (
                    <span className="badge ok">hast du</span>
                  ) : e.wanted ? (
                    <span className="badge">auf Wantlist</span>
                  ) : (
                    <button className="btn small" onClick={() => want(e.main.id)}>
                      Wantlist
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Deine Labels nach Anzahl Platten, von hier aus vervollständigen */
export function LabelsIndex() {
  const labels = useLiveQuery(async () => {
    const ids = [...new Set((await db.collection.toArray()).map((c) => c.releaseId))];
    const rels = await db.releases.bulkGet(ids);
    const m = new Map<number, { id: number; name: string; count: number; thumb?: string }>();
    for (const r of rels) {
      const l = r?.labels.find((x) => x.id);
      if (!l?.id || /^not on label/i.test(l.name)) continue;
      const e = m.get(l.id) ?? { id: l.id, name: l.name.replace(/\s\(\d+\)$/, ""), count: 0, thumb: r!.thumb };
      e.count++;
      m.set(l.id, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  }, []);
  return (
    <>
      <NavBar title="Labels" backTo="/collection" backLabel="Sammlung" />
      <div className="page stack">
        <p className="sub" style={{ margin: 0 }}>Deine Labels, meiste Platten zuerst. Tippe auf ein Label, um zu sehen, was dir noch fehlt.</p>
        {!labels && <SkeletonRows n={6} />}
        {labels?.length === 0 && <Empty title="Noch keine Labels">Sobald deine Sammlung geladen ist, stehen hier deine Labels.</Empty>}
        <div className="list">
          {labels?.map((l) => (
            <Link key={l.id} to={`/label/${l.id}`} viewTransition className="rec" style={{ color: "inherit" }}>
              <Cover src={l.thumb} />
              <div className="rec-main">
                <div className="rec-title">{l.name}</div>
                <div className="rec-artist">
                  {l.count} {l.count === 1 ? "Platte" : "Platten"} in deiner Kiste
                </div>
              </div>
              <span className="chev">›</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
