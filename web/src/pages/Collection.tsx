import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release, type TrackMeta } from "../lib/db";
import { Cover, Empty, KeyBadge, markHero, RecordRow, Seg, SkeletonRows, useDebounced } from "../components/bits";
import { IconCamera, IconSearch } from "../components/icons";
import { keyDistance, parseKey } from "../../../shared/music";

type Sort = "added" | "artist" | "title" | "year" | "label" | "bpm";

export default function Collection() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 200);
  const [sort, setSort] = useState<Sort>("added");
  const [view, setView] = useState<"list" | "grid">("list");
  const [style, setStyle] = useState<string | null>(null);
  const [bpmMin, setBpmMin] = useState("");
  const [bpmMax, setBpmMax] = useState("");
  const [keyMatch, setKeyMatch] = useState("");
  const [filter, setFilter] = useState<"all" | "nosticker" | "nobpm">("all");

  const data = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const [rels, metas, tracks] = await Promise.all([db.releases.bulkGet(ids), db.recordMeta.bulkGet(ids), db.tracks.where("releaseId").anyOf(ids).toArray()]);
    const added = new Map(coll.map((c) => [c.releaseId, c.dateAdded]));
    const byRel = new Map<number, TrackMeta[]>();
    tracks.forEach((t) => byRel.set(t.releaseId, [...(byRel.get(t.releaseId) ?? []), t]));
    return ids.map((id, i) => ({ r: rels[i]!, meta: metas[i], tracks: byRel.get(id) ?? [], added: added.get(id) ?? "" })).filter((x) => x.r);
  });

  const styles = useMemo(() => {
    const c = new Map<string, number>();
    data?.forEach((d) => d.r.styles.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const min = Number(bpmMin) || 0;
    const max = Number(bpmMax) || 999;
    const km = parseKey(keyMatch);
    let out = data.filter(({ r, meta, tracks }) => {
      if (dq) {
        const hay = `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${tracks.map((t) => t.title).join(" ")} ${meta?.shelf ?? ""} ${r.styles.join(" ")}`.toLowerCase();
        if (!dq.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (style && !r.styles.includes(style)) return false;
      if (filter === "nosticker" && meta?.stickerPrintedAt) return false;
      if (filter === "nobpm" && tracks.length && tracks.every((t) => t.bpm)) return false;
      if (bpmMin || bpmMax) {
        if (!tracks.some((t) => t.bpm && t.bpm >= min && t.bpm <= max)) return false;
      }
      if (km && !tracks.some((t) => keyDistance(km, parseKey(t.key)) <= 1)) return false;
      return true;
    });
    const avgBpm = (t: TrackMeta[]) => {
      const b = t.filter((x) => x.bpm).map((x) => x.bpm!);
      return b.length ? b.reduce((a, c) => a + c, 0) / b.length : 0;
    };
    const cmp: Record<Sort, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      added: (a, b) => b.added.localeCompare(a.added),
      artist: (a, b) => a.r.artist.localeCompare(b.r.artist, "de"),
      title: (a, b) => a.r.title.localeCompare(b.r.title, "de"),
      year: (a, b) => (b.r.year || 0) - (a.r.year || 0),
      label: (a, b) => (a.r.labels[0]?.name ?? "").localeCompare(b.r.labels[0]?.name ?? "", "de") || (a.r.labels[0]?.catno ?? "").localeCompare(b.r.labels[0]?.catno ?? "", "de", { numeric: true }),
      bpm: (a, b) => avgBpm(a.tracks) - avgBpm(b.tracks),
    };
    out = [...out].sort(cmp[sort]);
    return out;
  }, [data, dq, style, sort, bpmMin, bpmMax, keyMatch, filter]);

  const bpmRange = (tracks: TrackMeta[]) => {
    const b = tracks.filter((t) => t.bpm).map((t) => t.bpm!);
    if (!b.length) return null;
    const lo = Math.min(...b);
    const hi = Math.max(...b);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sammlung</h1>
          <div className="sub">
            {list.length} von {data?.length ?? 0} Platten
          </div>
        </div>
        <Seg value={view} options={[["list", "Liste"], ["grid", "Cover"]]} onChange={setView} />
      </div>
      <div className="page stack">
        <div className="search-bar">
          <IconSearch />
          <input className="input" placeholder="Artist, Titel, Label, Track, Regalplatz …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chips">
          {(
            [
              ["added", "Neueste"],
              ["artist", "Artist"],
              ["title", "Titel"],
              ["label", "Label"],
              ["year", "Jahr"],
              ["bpm", "BPM"],
            ] as [Sort, string][]
          ).map(([v, l]) => (
            <button key={v} className={`chip ${sort === v ? "on" : ""}`} onClick={() => setSort(v)}>
              {l}
            </button>
          ))}
          <span style={{ width: 8, flex: "none" }} />
          <button className={`chip ${filter === "nosticker" ? "on" : ""}`} onClick={() => setFilter(filter === "nosticker" ? "all" : "nosticker")}>
            Ohne Sticker
          </button>
          <button className={`chip ${filter === "nobpm" ? "on" : ""}`} onClick={() => setFilter(filter === "nobpm" ? "all" : "nobpm")}>
            BPM fehlt
          </button>
        </div>
        <div className="row">
          <input className="input" inputMode="numeric" placeholder="BPM ab" value={bpmMin} onChange={(e) => setBpmMin(e.target.value)} />
          <input className="input" inputMode="numeric" placeholder="bis" value={bpmMax} onChange={(e) => setBpmMax(e.target.value)} />
          <input className="input" placeholder="Key, z.B. 8A" value={keyMatch} onChange={(e) => setKeyMatch(e.target.value)} />
        </div>
        {styles.length > 0 && (
          <div className="chips">
            {styles.map(([s, n]) => (
              <button key={s} className={`chip ${style === s ? "on" : ""}`} onClick={() => setStyle(style === s ? null : s)}>
                {s} <span className="sub">{n}</span>
              </button>
            ))}
          </div>
        )}

        {view === "list" ? (
          <div className="list rise" key={`${sort}${style}${filter}`}>
            {list.slice(0, 400).map(({ r, tracks, meta }) => (
              <RecordRow
                key={r.id}
                r={r as Release}
                side={
                  <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
                    {bpmRange(tracks) && <span className="bpm" style={{ fontSize: 14 }}>{bpmRange(tracks)}</span>}
                    <div className="row" style={{ gap: 3 }}>
                      {[...new Set(tracks.map((t) => t.key).filter(Boolean))].slice(0, 2).map((k) => (
                        <KeyBadge key={k} k={k} />
                      ))}
                    </div>
                    {meta?.shelf && <span className="sub">{meta.shelf}</span>}
                  </div>
                }
              />
            ))}
          </div>
        ) : (
          <div className="cover-grid">
            {list.slice(0, 600).map(({ r }) => (
              <Link key={r.id} to={`/release/${r.id}`} viewTransition state={{ preview: { thumb: r.thumb, cover: r.cover, title: r.title, artist: r.artist } }} onClick={(e) => markHero(e.currentTarget)} className="press">
                <Cover src={r.cover || r.thumb} />
              </Link>
            ))}
          </div>
        )}
        {list.length > 400 && view === "list" && <div className="sub">Zeige 400 von {list.length}. Nutze die Suche oder Filter.</div>}
        {!data && <SkeletonRows />}
        {data && data.length === 0 && <Empty title="Noch keine Platten">Auf der Startseite synchronisieren oder eine Platte scannen.</Empty>}
        {data && data.length > 0 && list.length === 0 && <Empty title="Nichts gefunden">Filter lockern oder anders suchen.</Empty>}
      </div>
      <Link to="/scan" viewTransition className="fab no-print" aria-label="Platte scannen">
        <IconCamera />
      </Link>
    </>
  );
}
