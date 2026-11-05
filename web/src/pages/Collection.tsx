import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release, type TrackMeta } from "../lib/db";
import { autoPipeline, fetchMissingDetails } from "../lib/sync";
import { toast } from "../lib/store";
import { CAMELOT_COLORS, Cover, Empty, KeyBadge, markHero, RecordRow, Sheet, SkeletonRows, useDebounced } from "../components/bits";
import { IconCamera, IconCart, IconGrid, IconMore, IconRows, IconSearch, IconSync, IconTag } from "../components/icons";
import { ActiveChips, AlphaIndex, ChipGroup, FilterGroup, FilterButton, letterOf, MenuSheet, SectionList, sectionsOf, SortButton, SortSheet, sortKey, usePersisted, type SortOption, type SortState } from "../components/ui";
import { matchesQuery } from "../../../shared/textSearch";
import { gradeRank, shortGrade } from "../../../shared/vinyl";
import { keyDistance, parseKey } from "../../../shared/music";
import { roughly } from "../../../shared/value";
import { money } from "../lib/format";
import { cachedCollectionValue, recordValues, refreshCollectionValue } from "../lib/value";
import { refreshPrices, suggestionsState } from "../lib/prices";

const SORTS: SortOption[] = [
  { id: "added", label: "Hinzugefügt", dirs: ["Neueste zuerst", "Älteste zuerst"], defaultDir: "desc" },
  { id: "artist", label: "Artist", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "title", label: "Titel", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "label", label: "Label & Katalognr.", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "year", label: "Erscheinungsjahr", dirs: ["Neueste zuerst", "Älteste zuerst"], defaultDir: "desc" },
  { id: "bpm", label: "Tempo", dirs: ["Schnell – langsam", "Langsam – schnell"], defaultDir: "asc" },
  { id: "condition", label: "Zustand", dirs: ["Beste zuerst", "Schwächste zuerst"], defaultDir: "desc" },
  { id: "value", label: "Wert", dirs: ["Wertvollste zuerst", "Günstigste zuerst"], defaultDir: "desc" },
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
  const [sheet, setSheet] = useState<"sort" | "filter" | "more" | "value" | null>(null);
  // Wert: Gesamtwert von Discogs, Einzelwerte aus geladenen Preisen
  const total = useLiveQuery(() => cachedCollectionValue(), []);
  const values = useLiveQuery(() => recordValues(), [], new Map() as Awaited<ReturnType<typeof recordValues>>);
  useEffect(() => {
    refreshCollectionValue().catch(() => undefined);
  }, []);
  // Sprung aus der DJ-Übersicht: Filter aus der Adresse übernehmen (ersetzt den alten Filter)
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const bpm = params.get("bpm")?.match(/^(\d+)-(\d+)$/);
    const key = params.get("key");
    const noBpm = params.get("nobpm") === "1";
    if (!bpm && !key && !noBpm) return;
    setF({ ...NO_FILTERS, ...(bpm ? { bpmMin: bpm[1], bpmMax: bpm[2] } : {}), ...(key ? { keys: [key] } : {}), noBpm });
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
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
      .map((id, i) => ({ r: rels[i]!, meta: metas[i], tracks: byRel.get(id) ?? [], added: byColl.get(id)?.dateAdded ?? "", rating: byColl.get(id)?.rating ?? 0, media: shortGrade(byColl.get(id)?.media), sleeve: shortGrade(byColl.get(id)?.sleeve) }))
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
        const hay = `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${tracks.map((t) => t.title).join(" ")} ${meta?.shelf ?? ""} ${r.styles.join(" ")} ${r.year}`;
        if (!matchesQuery(hay, dq)) return false;
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
      condition: (a, b) => gradeRank(a.media) - gradeRank(b.media),
      value: (a, b) => (values.get(a.r.id)?.value ?? 0) - (values.get(b.r.id)?.value ?? 0),
      shelf: (a, b) => (a.meta?.shelf || "~").localeCompare(b.meta?.shelf || "~", "de", { numeric: true }),
    };
    const cmp = by[sort.id] ?? by.added;
    // Einträge ohne Wert (BPM, Regalplatz) immer ans Ende
    return [...out].sort((a, b) => {
      if (sort.id === "bpm") {
        const ea = !avgBpm(a.tracks), eb = !avgBpm(b.tracks);
        if (ea !== eb) return ea ? 1 : -1;
      }
      if (sort.id === "condition") {
        const ea = !a.media, eb = !b.media;
        if (ea !== eb) return ea ? 1 : -1;
      }
      if (sort.id === "value") {
        const ea = !values.has(a.r.id), eb = !values.has(b.r.id);
        if (ea !== eb) return ea ? 1 : -1;
      }
      if (sort.id === "shelf") {
        const ea = !a.meta?.shelf, eb = !b.meta?.shelf;
        if (ea !== eb) return ea ? 1 : -1;
      }
      return cmp(a, b) * dir;
    });
  }, [data, dq, f, sort, values]);

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
      case "condition":
        return (x: Item) => x.media ?? "Nicht bewertet";
      case "value":
        return (x: Item) => {
          const v = values.get(x.r.id)?.value;
          return v == null ? "Ohne Preis" : v >= 100 ? "Ab 100" : v >= 50 ? "50 bis 100" : v >= 20 ? "20 bis 50" : "Unter 20";
        };
      case "shelf":
        return (x: Item) => x.meta?.shelf || "Ohne Regalplatz";
      default:
        return (x: Item) => (x.added ? new Date(x.added).toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : "Unbekannt");
    }
  }, [sort.id, values]);
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
          {total && total.median > 0 && (
            <button className="value-line press" onClick={() => setSheet("value")}>
              Wert ca. <b>{money(roughly(total.median), total.currency).replace(/,00(?=\s|$)/, "")}</b> ›
            </button>
          )}
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

      <div className="toolbar" ref={toolbar} data-title="Sammlung">
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
            render={({ r, tracks, meta, rating, media, sleeve }: Item) => (
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
                    {(media || sleeve) && <span className="grade-tag mono">{[media ?? "–", sleeve ?? "–"].join("/")}</span>}
                    {sort.id === "value" && values.get(r.id) && <span className="tiny mono">{money(values.get(r.id)!.value, values.get(r.id)!.currency)}</span>}
                    {sort.id === "rating" && rating > 0 && <span className="tiny" style={{ color: "var(--accent)" }}>{"★".repeat(rating)}</span>}
                    {meta?.shelf && sort.id !== "shelf" && <span className="tiny">{meta.shelf}</span>}
                    {meta?.lentTo && <span className="badge accent">bei {meta.lentTo}</span>}
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
          { label: "Wert der Sammlung", icon: <IconCart />, onClick: () => setSheet("value") },
          { label: "Beschriften (Einleger & Sticker)", icon: <IconTag />, onClick: () => nav("/stickers", { viewTransition: true }) },
          { label: "Alles abgleichen & ergänzen", icon: <IconSync />, onClick: () => autoPipeline({ force: true }).then(() => toast("Alles synchron und analysiert"), (e) => toast(e.message)) },
          { label: "Fehlende Tracklists laden", icon: <IconRows />, onClick: () => fetchMissingDetails("collection").catch((e) => toast(e.message)) },
        ]}
      />
      <Sheet open={sheet === "value"} onClose={() => setSheet(null)}>
        {sheet === "value" && <ValueSheet total={total ?? null} values={values} count={data?.length ?? 0} onSort={() => (setSort({ id: "value", dir: "desc" }), setSheet(null))} />}
      </Sheet>
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


const BASIS: Record<string, string> = { grade: "nach deinem Zustand", vgplus: "Richtwert VG+", lowest: "günstigstes Angebot" };

/** Wert der Sammlung: Gesamtwert von Discogs, wertvollste Platten, Einzelwerte nachladen */
function ValueSheet({ total, values, count, onSort }: { total: Awaited<ReturnType<typeof cachedCollectionValue>>; values: Awaited<ReturnType<typeof recordValues>>; count: number; onSort: () => void }) {
  const [busy, setBusy] = useState(false);
  const sugg = useLiveQuery(() => suggestionsState(), [], "unknown");
  const top = useLiveQuery(async () => {
    const best = [...values.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10);
    const rels = await db.releases.bulkGet(best.map(([id]) => id));
    return best.map(([id, v], i) => ({ id, v, r: rels[i] })).filter((x) => x.r);
  }, [values], []);
  const fmt = (v: number, c = total?.currency ?? "EUR") => money(roughly(v), c).replace(/,00(?=\s|$)/, "");
  const missing = count - values.size;
  const loadAll = async () => {
    setBusy(true);
    try {
      const coll = await db.collection.toArray();
      const ids = [...new Set(coll.map((c) => c.releaseId))];
      const have = new Set(values.keys());
      const todo = [...ids.filter((id) => !have.has(id)), ...ids.filter((id) => have.has(id))];
      toast("Preise werden im Hintergrund geladen");
      await refreshPrices(todo, { maxAgeHours: 24 * 7, background: true });
      await refreshCollectionValue(true).catch(() => undefined);
      toast("Einzelwerte geladen");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const minutes = Math.max(1, Math.ceil((missing * (sugg === "needs-seller-settings" ? 1 : 2)) / 40));
  return (
    <div className="stack">
      <div className="value-head">
        <span className="eyebrow">Wert der Sammlung</span>
        {total && total.median > 0 ? (
          <>
            <b className="value-big">{fmt(total.median)}</b>
            <span className="sub">
              Spanne {fmt(total.min)} bis {fmt(total.max)}
            </span>
          </>
        ) : (
          <b className="value-big">–</b>
        )}
        <p className="tiny">
          Discogs rechnet mit dem, was deine Platten zuletzt wirklich gekostet haben (Median der Verkäufe). Platten ohne Verkäufe zählen nicht mit. Das ist ein Richtwert, kein Ankaufspreis.
        </p>
      </div>

      {top.length > 0 && (
        <>
          <div className="row">
            <h3 style={{ margin: 0 }}>Die wertvollsten</h3>
            <span className="spacer" />
            <button className="text-btn" onClick={onSort}>
              Alle nach Wert
            </button>
          </div>
          <div className="list">
            {top.map(({ id, v, r }, i) => (
              <Link key={id} to={`/release/${id}`} viewTransition className="rec value-rec" style={{ color: "inherit" }}>
                <span className="shared-num">{i + 1}</span>
                <Cover src={r!.thumb} />
                <div className="rec-main">
                  <div className="rec-title">{r!.title}</div>
                  <div className="rec-artist">{r!.artist}</div>
                  <div className="rec-meta">
                    <span>{BASIS[v.basis]}</span>
                  </div>
                </div>
                <b className="mono">{money(v.value, v.currency)}</b>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="card stack" style={{ gap: 8 }}>
        <b>{missing > 0 ? `Einzelwerte für ${values.size} von ${count} Platten` : "Alle Platten haben einen Einzelwert"}</b>
        <span className="sub">
          {sugg === "needs-seller-settings"
            ? "Für Preise nach Zustand musst du bei Discogs einmal die Verkäufer-Einstellungen ausfüllen. Bis dahin nimmt Crate das günstigste Angebot."
            : "Crate nimmt die Discogs-Preisempfehlung für den Zustand, den du eingetragen hast. Ohne Zustand gilt VG+."}
        </span>
        {missing > 0 && (
          <button className="btn tinted" disabled={busy} onClick={loadAll}>
            {busy ? "Lädt im Hintergrund …" : `Fehlende laden (etwa ${minutes} Min.)`}
          </button>
        )}
      </div>
    </div>
  );
}
