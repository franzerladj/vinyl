import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release, type TrackMeta } from "../lib/db";
import { autoPipeline, fetchMissingDetails } from "../lib/sync";
import { toast } from "../lib/store";
import { CAMELOT_COLORS, Cover, Empty, KeyBadge, markHero, RecordRow, Sheet, SkeletonRows, useDebounced } from "../components/bits";
import { IconCamera, IconGrid, IconMore, IconRows, IconSearch, IconSparkle, IconTag } from "../components/icons";
import { ActiveChips, AlphaIndex, ChipGroup, FilterGroup, FilterButton, letterOf, MenuSheet, SectionList, sectionsOf, SortButton, SortSheet, sortKey, usePersisted, type SortOption, type SortState } from "../components/ui";
import { keyDistance, parseKey } from "../../../shared/music";

const SORTS: SortOption[] = [
  { id: "added", label: "Hinzugefügt", dirs: ["Neueste zuerst", "Älteste zuerst"], defaultDir: "desc" },
  { id: "artist", label: "Artist", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "title", label: "Titel", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "label", label: "Label & Katalognr.", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "year", label: "Erscheinungsjahr", dirs: ["Neueste zuerst", "Älteste zuerst"], defaultDir: "desc" },
  { id: "bpm", label: "Tempo", dirs: ["Schnell – langsam", "Langsam – schnell"], defaultDir: "asc" },
  { id: "rating", label: "Deine Bewertung", dirs: ["Beste zuerst", "Schwächste zuerst"], defaultDir: "desc" },
  { id: "shelf", label: "Regalplatz", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
];

interface Filters {
  styles: string[];
  decades: string[];
  formats: string[];
  crates: string[];
  keys: string[];
  bpmMin: string;
  bpmMax: string;
  minRating: number;
  noSticker: boolean;
  noBpm: boolean;
  noShelf: boolean;
}
const NO_FILTERS: Filters = { styles: [], decades: [], formats: [], crates: [], keys: [], bpmMin: "", bpmMax: "", minRating: 0, noSticker: false, noBpm: false, noShelf: false };

const BPM_PRESETS: [string, number, number][] = [
  ["Downtempo", 80, 110],
  ["Warm-up", 110, 120],
  ["House", 120, 126],
  ["Tech", 125, 130],
  ["Techno", 128, 145],
];

const formatOf = (r: Release) => {
  const d = r.formats.flatMap((f) => [f.name, ...(f.descriptions ?? [])]).join(" ");
  if (/7"/.test(d)) return '7"';
  if (/10"/.test(d)) return '10"';
  if (/LP/.test(d)) return "LP";
  if (/12"/.test(d)) return '12"';
  return "Andere";
};
const decadeOf = (y: number) => (y ? `${Math.floor(y / 10) * 10}er` : "Ohne Jahr");
const avgBpm = (t: TrackMeta[]) => {
  const b = t.filter((x) => x.bpm).map((x) => x.bpm!);
  return b.length ? b.reduce((a, c) => a + c, 0) / b.length : 0;
};

export default function Collection() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 180);
  const [sort, setSort] = usePersisted<SortState>("coll-sort", { id: "added", dir: "desc" });
  const [view, setView] = usePersisted<{ v: "list" | "grid" }>("coll-view", { v: "list" });
  const [f, setF] = usePersisted<Filters>("coll-filter", NO_FILTERS);
  const [sheet, setSheet] = useState<"sort" | "filter" | "more" | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [toolbarH, setToolbarH] = useState(0);

  useLayoutEffect(() => {
    const el = toolbar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const [rels, metas, tracks] = await Promise.all([db.releases.bulkGet(ids), db.recordMeta.bulkGet(ids), db.tracks.where("releaseId").anyOf(ids).toArray()]);
    const byColl = new Map(coll.map((c) => [c.releaseId, c]));
    const byRel = new Map<number, TrackMeta[]>();
    tracks.forEach((t) => byRel.set(t.releaseId, [...(byRel.get(t.releaseId) ?? []), t]));
    return ids
      .map((id, i) => ({ r: rels[i]!, meta: metas[i], tracks: byRel.get(id) ?? [], added: byColl.get(id)?.dateAdded ?? "", rating: byColl.get(id)?.rating ?? 0 }))
      .filter((x) => x.r);
  });

  const facets = useMemo(() => {
    const count = (vals: string[]) => {
      const m = new Map<string, number>();
      vals.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      styles: count((data ?? []).flatMap((d) => d.r.styles)),
      decades: count((data ?? []).map((d) => decadeOf(d.r.year))).sort((a, b) => a[0].localeCompare(b[0])),
      formats: count((data ?? []).map((d) => formatOf(d.r))),
      crates: count((data ?? []).flatMap((d) => d.meta?.crates ?? [])),
    };
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const min = Number(f.bpmMin) || 0;
    const max = Number(f.bpmMax) || 999;
    const keys = f.keys.map(parseKey).filter(Boolean);
    const out = data.filter(({ r, meta, tracks, rating }) => {
      if (dq) {
        const hay = `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${tracks.map((t) => t.title).join(" ")} ${meta?.shelf ?? ""} ${r.styles.join(" ")} ${r.year}`.toLowerCase();
        if (!dq.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (f.styles.length && !f.styles.some((s) => r.styles.includes(s))) return false;
      if (f.decades.length && !f.decades.includes(decadeOf(r.year))) return false;
      if (f.formats.length && !f.formats.includes(formatOf(r))) return false;
      if (f.crates.length && !f.crates.some((c) => meta?.crates?.includes(c))) return false;
      if (f.minRating && rating < f.minRating) return false;
      if (f.noSticker && meta?.stickerPrintedAt) return false;
      if (f.noShelf && meta?.shelf) return false;
      if (f.noBpm && tracks.length && tracks.every((t) => t.bpm)) return false;
      if ((f.bpmMin || f.bpmMax) && !tracks.some((t) => t.bpm && t.bpm >= min && t.bpm <= max)) return false;
      if (keys.length && !tracks.some((t) => keys.some((k) => keyDistance(k, parseKey(t.key)) <= 1))) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const by: Record<string, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      added: (a, b) => a.added.localeCompare(b.added),
      artist: (a, b) => sortKey(a.r.artist).localeCompare(sortKey(b.r.artist), "de") || a.r.year - b.r.year,
      title: (a, b) => sortKey(a.r.title).localeCompare(sortKey(b.r.title), "de"),
      label: (a, b) => (a.r.labels[0]?.name ?? "").localeCompare(b.r.labels[0]?.name ?? "", "de") || (a.r.labels[0]?.catno ?? "").localeCompare(b.r.labels[0]?.catno ?? "", "de", { numeric: true }),
      year: (a, b) => (a.r.year || 0) - (b.r.year || 0),
      bpm: (a, b) => (avgBpm(a.tracks) || 999) - (avgBpm(b.tracks) || 999),
      rating: (a, b) => a.rating - b.rating,
      shelf: (a, b) => (a.meta?.shelf || "~").localeCompare(b.meta?.shelf || "~", "de", { numeric: true }),
    };
    const cmp = by[sort.id] ?? by.added;
    // Einträge ohne Wert (BPM, Regalplatz) immer ans Ende
    return [...out].sort((a, b) => {
      if (sort.id === "bpm") {
        const ea = !avgBpm(a.tracks), eb = !avgBpm(b.tracks);
        if (ea !== eb) return ea ? 1 : -1;
      }
      if (sort.id === "shelf") {
        const ea = !a.meta?.shelf, eb = !b.meta?.shelf;
        if (ea !== eb) return ea ? 1 : -1;
      }
      return cmp(a, b) * dir;
    });
  }, [data, dq, f, sort]);

  type Item = (typeof list)[0];
  const sectionKey: ((x: Item) => string) | null = useMemo(() => {
    switch (sort.id) {
      case "artist":
        return (x: Item) => letterOf(x.r.artist);
      case "title":
        return (x: Item) => letterOf(x.r.title);
      case "label":
        return (x: Item) => x.r.labels[0]?.name.replace(/\s\(\d+\)$/, "") ?? "Ohne Label";
      case "year":
        return (x: Item) => decadeOf(x.r.year);
      case "bpm":
        return (x: Item) => {
          const b = avgBpm(x.tracks);
          if (!b) return "Ohne BPM";
          const lo = Math.floor(b / 5) * 5;
          return `${lo}–${lo + 4} BPM`;
        };
      case "rating":
        return (x: Item) => (x.rating ? "★".repeat(x.rating) : "Ohne Bewertung");
      case "shelf":
        return (x: Item) => x.meta?.shelf || "Ohne Regalplatz";
      default:
        return (x: Item) => (x.added ? new Date(x.added).toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : "Unbekannt");
    }
  }, [sort.id]);
  const sections = useMemo(() => sectionsOf(list, sectionKey), [list, sectionKey]);
  const letters = sort.id === "artist" || sort.id === "title" ? sections.map(([k]) => k) : [];

  const bpmRange = (tracks: TrackMeta[]) => {
    const b = tracks.filter((t) => t.bpm).map((t) => Math.round(t.bpm!));
    if (!b.length) return null;
    const lo = Math.min(...b);
    const hi = Math.max(...b);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };

  const chips = [
    ...f.styles.map((s) => ({ key: `s${s}`, label: s, remove: () => setF((p) => ({ ...p, styles: p.styles.filter((x) => x !== s) })) })),
    ...f.decades.map((s) => ({ key: `d${s}`, label: s, remove: () => setF((p) => ({ ...p, decades: p.decades.filter((x) => x !== s) })) })),
    ...f.formats.map((s) => ({ key: `f${s}`, label: s, remove: () => setF((p) => ({ ...p, formats: p.formats.filter((x) => x !== s) })) })),
    ...f.crates.map((s) => ({ key: `c${s}`, label: `Crate: ${s}`, remove: () => setF((p) => ({ ...p, crates: p.crates.filter((x) => x !== s) })) })),
    ...f.keys.map((s) => ({ key: `k${s}`, label: `passt zu ${s}`, remove: () => setF((p) => ({ ...p, keys: p.keys.filter((x) => x !== s) })) })),
    ...(f.bpmMin || f.bpmMax ? [{ key: "bpm", label: `${f.bpmMin || "…"}–${f.bpmMax || "…"} BPM`, remove: () => setF((p) => ({ ...p, bpmMin: "", bpmMax: "" })) }] : []),
    ...(f.minRating ? [{ key: "r", label: `ab ${"★".repeat(f.minRating)}`, remove: () => setF((p) => ({ ...p, minRating: 0 })) }] : []),
    ...(f.noShelf ? [{ key: "ns", label: "Ohne Regalplatz", remove: () => setF((p) => ({ ...p, noShelf: false })) }] : []),
  ];
  const filterCount = chips.length + (f.noSticker ? 1 : 0) + (f.noBpm ? 1 : 0);
  const totalTracks = data?.reduce((n, d) => n + d.tracks.length, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sammlung</h1>
          <div className="sub">{data ? `${data.length} Platten · ${totalTracks} Tracks` : " "}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn round" onClick={() => setView({ v: view.v === "list" ? "grid" : "list" })} aria-label={view.v === "list" ? "Cover-Ansicht" : "Listen-Ansicht"}>
            {view.v === "list" ? <IconGrid /> : <IconRows />}
          </button>
          <button className="icon-btn round" onClick={() => setSheet("more")} aria-label="Mehr">
            <IconMore />
          </button>
        </div>
      </div>

      <div className="toolbar" ref={toolbar}>
        <div className="search-bar">
          <IconSearch />
          <input className="input" type="search" placeholder="Artist, Titel, Label, Track, Regal …" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </div>
        <div className="toolbar-row">
          <SortButton options={SORTS} value={sort} onClick={() => setSheet("sort")} />
          <FilterButton count={filterCount} onClick={() => setSheet("filter")} />
          <span className="tool-sep" />
          <button className={`tool-btn ${f.noSticker ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, noSticker: !p.noSticker }))}>
            Unbeschriftet
          </button>
          <button className={`tool-btn ${f.noBpm ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, noBpm: !p.noBpm }))}>
            BPM fehlt
          </button>
          <ActiveChips items={chips} onClear={() => setF(NO_FILTERS)} />
        </div>
        {data && (dq || filterCount > 0) && (
          <div className="result-line">
            {list.length} von {data.length} Platten
            {filterCount > 0 && (
              <button className="text-btn" style={{ fontSize: 13, minHeight: 0, padding: 0 }} onClick={() => setF(NO_FILTERS)}>
                Filter zurücksetzen
              </button>
            )}
          </div>
        )}
      </div>

      <div className="page" style={{ paddingTop: 0, paddingRight: letters.length >= 6 && view.v === "list" ? 24 : undefined }}>
        {!data && <SkeletonRows />}
        {view.v === "list" ? (
          <SectionList
            sections={sections}
            stickyTop={toolbarH}
            render={({ r, tracks, meta, rating }: Item) => (
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
                    {sort.id === "rating" && rating > 0 && <span className="tiny" style={{ color: "var(--accent)" }}>{"★".repeat(rating)}</span>}
                    {meta?.shelf && sort.id !== "shelf" && <span className="tiny">{meta.shelf}</span>}
                  </div>
                }
              />
            )}
          />
        ) : (
          <SectionList
            sections={sections}
            stickyTop={toolbarH}
            className="cover-grid captions"
            render={({ r }: Item) => (
              <Link key={r.id} to={`/release/${r.id}`} viewTransition state={{ preview: { thumb: r.thumb, cover: r.cover, title: r.title, artist: r.artist } }} onClick={(e) => markHero(e.currentTarget)} className="press">
                {r.cover || r.thumb ? <Cover src={r.cover || r.thumb} /> : <div className="cover ph">{letterOf(r.artist)}</div>}
                <div className="cap-t">{r.title}</div>
                <div className="cap-a">{r.artist}</div>
              </Link>
            )}
          />
        )}
        {view.v === "list" && <AlphaIndex letters={letters} offset={toolbarH} />}
        {data && data.length === 0 && (
          <Empty title="Noch keine Platten" action={<button className="btn primary" onClick={() => autoPipeline({ force: true }).catch((e) => toast(e.message))}>Von Discogs laden</button>}>
            Synchronisiere deine Discogs-Sammlung oder scanne eine Platte.
          </Empty>
        )}
        {data && data.length > 0 && list.length === 0 && (
          <Empty title="Nichts gefunden" action={<button className="btn tinted" onClick={() => (setQ(""), setF(NO_FILTERS))}>Suche und Filter zurücksetzen</button>}>
            Keine Platte passt zu Suche und Filtern.
          </Empty>
        )}
      </div>

      <Link to="/scan" viewTransition className="fab no-print" aria-label="Platte hinzufügen">
        <IconCamera />
      </Link>

      <SortSheet open={sheet === "sort"} onClose={() => setSheet(null)} options={SORTS} value={sort} onChange={setSort} />
      <MenuSheet
        open={sheet === "more"}
        onClose={() => setSheet(null)}
        items={[
          { label: "Platte hinzufügen", icon: <IconCamera />, onClick: () => nav("/scan", { viewTransition: true }) },
          { label: "Beschriften (Einleger & Sticker)", icon: <IconTag />, onClick: () => nav("/stickers", { viewTransition: true }) },
          { label: "Alles synchronisieren & analysieren", icon: <IconSparkle />, onClick: () => autoPipeline({ force: true }).then(() => toast("Alles synchron und analysiert"), (e) => toast(e.message)) },
          { label: "Fehlende Tracklists laden", icon: <IconRows />, onClick: () => fetchMissingDetails("collection").catch((e) => toast(e.message)) },
        ]}
      />
      <Sheet open={sheet === "filter"} onClose={() => setSheet(null)}>
        <div className="sheet-title">
          <h3>Filter</h3>
          <button className="text-btn" onClick={() => setF(NO_FILTERS)} disabled={filterCount === 0}>
            Zurücksetzen
          </button>
        </div>

        <FilterGroup title="Tempo">
          <div className="chip-wrap" style={{ marginBottom: 10 }}>
            {BPM_PRESETS.map(([l, a, b]) => (
              <button key={l} className={`chip ${f.bpmMin === String(a) && f.bpmMax === String(b) ? "on" : ""}`} onClick={() => setF((p) => (p.bpmMin === String(a) && p.bpmMax === String(b) ? { ...p, bpmMin: "", bpmMax: "" } : { ...p, bpmMin: String(a), bpmMax: String(b) }))}>
                {l} <span className="sub">{a}–{b}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <input className="input" inputMode="numeric" placeholder="von BPM" value={f.bpmMin} onChange={(e) => setF((p) => ({ ...p, bpmMin: e.target.value.replace(/\D/g, "") }))} />
            <span className="sub">bis</span>
            <input className="input" inputMode="numeric" placeholder="bis BPM" value={f.bpmMax} onChange={(e) => setF((p) => ({ ...p, bpmMax: e.target.value.replace(/\D/g, "") }))} />
          </div>
        </FilterGroup>

        <FilterGroup title="Passt harmonisch zu" hint="zeigt Platten mit Tracks in derselben oder einer Nachbar-Tonart">
          <div className="camelot-grid">
            {Array.from({ length: 24 }, (_, i) => {
              const num = (i % 12) + 1;
              const letter = i < 12 ? "A" : "B";
              const k = `${num}${letter}`;
              const on = f.keys.includes(k);
              return (
                <button key={k} className={on ? "on" : ""} style={{ background: CAMELOT_COLORS[num - 1] }} onClick={() => setF((p) => ({ ...p, keys: on ? p.keys.filter((x) => x !== k) : [...p.keys, k] }))} aria-pressed={on}>
                  {k}
                </button>
              );
            })}
          </div>
        </FilterGroup>

        <ChipGroup title="Styles" values={facets.styles} selected={f.styles} onToggle={(v) => setF((p) => ({ ...p, styles: toggle(p.styles, v) }))} />
        <ChipGroup title="Jahrzehnt" values={facets.decades} selected={f.decades} onToggle={(v) => setF((p) => ({ ...p, decades: toggle(p.decades, v) }))} />
        <ChipGroup title="Format" values={facets.formats} selected={f.formats} onToggle={(v) => setF((p) => ({ ...p, formats: toggle(p.formats, v) }))} />
        {facets.crates.length > 0 && <ChipGroup title="Crates" values={facets.crates} selected={f.crates} onToggle={(v) => setF((p) => ({ ...p, crates: toggle(p.crates, v) }))} />}

        <FilterGroup title="Deine Bewertung">
          <div className="chip-wrap">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={`chip ${f.minRating === n ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, minRating: n }))}>
                {n ? `ab ${"★".repeat(n)}` : "Alle"}
              </button>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup title="Pflege">
          <div className="chip-wrap">
            <button className={`chip ${f.noSticker ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, noSticker: !p.noSticker }))}>
              Noch nicht beschriftet
            </button>
            <button className={`chip ${f.noBpm ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, noBpm: !p.noBpm }))}>
              BPM fehlt
            </button>
            <button className={`chip ${f.noShelf ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, noShelf: !p.noShelf }))}>
              Ohne Regalplatz
            </button>
          </div>
        </FilterGroup>

        <div className="sheet-footer">
          <button className="btn primary block lg" onClick={() => setSheet(null)}>
            {list.length} Platten anzeigen
          </button>
        </div>
      </Sheet>
    </>
  );
}

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

