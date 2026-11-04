import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { discogs } from "../lib/api";
import { db } from "../lib/db";
import { addWant } from "../lib/sync";
import { toast } from "../lib/store";
import type { Pagination, SearchResult } from "../lib/types";
import { Cover, Empty, haptic, markHero, SkeletonRows } from "../components/bits";
import { IconBarcode, IconHeart, IconSearch } from "../components/icons";

const GENRES = ["Electronic", "Hip Hop", "Funk / Soul", "Jazz", "Rock", "Reggae", "Latin", "Pop", "Disco"];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const filters = {
    type: params.get("type") ?? "release",
    format: params.get("format") ?? "Vinyl",
    genre: params.get("genre") ?? "",
    style: params.get("style") ?? "",
    year: params.get("year") ?? "",
    country: params.get("country") ?? "",
    label: params.get("label") ?? "",
    catno: params.get("catno") ?? "",
    barcode: params.get("barcode") ?? "",
    artist: params.get("artist") ?? "",
    release_title: params.get("release_title") ?? "",
  };
  const page = Number(params.get("page") ?? 1);
  const hasQuery = Object.entries(filters).some(([k, v]) => v && !["type", "format"].includes(k)) || params.get("q");

  const owned = useLiveQuery(async () => new Set((await db.collection.toArray()).map((c) => c.releaseId)), [], new Set<number>());
  const wanted = useLiveQuery(async () => new Set(await db.wants.toCollection().primaryKeys()), [], new Set<number>());

  useEffect(() => {
    if (!hasQuery) return;
    const sp = new URLSearchParams();
    if (params.get("q")) sp.set("q", params.get("q")!);
    Object.entries(filters).forEach(([k, v]) => v && v !== "-" && sp.set(k, v));
    sp.set("per_page", "40");
    sp.set("page", String(page));
    setLoading(true);
    discogs<{ results: SearchResult[]; pagination: Pagination }>(`/database/search?${sp}`)
      .then((d) => {
        setResults((prev) => (page > 1 ? [...prev, ...d.results] : d.results));
        setPagination(d.pagination);
      })
      .catch((e) => toast(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  const update = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)));
    if (!("page" in patch)) sp.delete("page");
    setParams(sp, { replace: true });
  };

  const open = async (r: SearchResult) => {
    const [artist, ...rest] = r.title.split(" - ");
    const state = { preview: { thumb: r.thumb, cover: r.cover_image, title: rest.join(" - ") || r.title, artist } };
    if (r.type === "master") {
      const m = await discogs<{ main_release: number }>(`/masters/${r.id}`);
      nav(`/release/${m.main_release}`, { state, viewTransition: true });
    } else nav(`/release/${r.id}`, { state, viewTransition: true });
  };

  return (
    <>
      <div className="page-head">
        <h1>Suche</h1>
        <button className="btn small tinted" onClick={() => nav("/scan", { viewTransition: true })}>
          <IconBarcode /> Scan
        </button>
      </div>
      <div className="page stack">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q });
          }}
          className="search-bar"
        >
          <IconSearch />
          <input className="input" type="search" placeholder="Artist, Titel, Katalognummer …" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </form>
        <div className="chips">
          {[
            ["release", "Releases"],
            ["master", "Master"],
          ].map(([v, l]) => (
            <button key={v} className={`chip ${filters.type === v ? "on" : ""}`} onClick={() => update({ type: v })}>
              {l}
            </button>
          ))}
          <button className={`chip ${filters.format === "Vinyl" ? "on" : ""}`} onClick={() => update({ format: filters.format === "Vinyl" ? "-" : "Vinyl" })}>
            Nur Vinyl
          </button>
          {GENRES.map((g) => (
            <button key={g} className={`chip ${filters.genre === g ? "on" : ""}`} onClick={() => update({ genre: filters.genre === g ? "" : g })}>
              {g}
            </button>
          ))}
          <button className={`chip ${showFilters ? "on" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            Mehr Filter
          </button>
        </div>
        {showFilters && (
          <div className="card grid2">
            {(
              [
                ["artist", "Artist"],
                ["release_title", "Titel"],
                ["label", "Label"],
                ["catno", "Katalognr."],
                ["style", "Style (z.B. Deep House)"],
                ["year", "Jahr"],
                ["country", "Land"],
                ["barcode", "Barcode"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                {l}
                <input className="input" defaultValue={filters[k]} onBlur={(e) => update({ [k]: e.target.value })} />
              </label>
            ))}
          </div>
        )}

        <div className="list rise">
          {results.map((r) => {
            const [artist, ...rest] = r.title.split(" - ");
            return (
              <div
                key={`${r.type}${r.id}`}
                className="rec"
                onClick={(e) => {
                  markHero(e.currentTarget);
                  haptic();
                  void open(r);
                }}
              >
                <Cover src={r.thumb} />
                <div className="rec-main">
                  <div className="rec-title">{rest.join(" - ") || r.title}</div>
                  <div className="rec-artist">{artist}</div>
                  <div className="rec-meta">
                    {r.label?.[0] && <span>{r.label[0]}</span>}
                    {r.catno && <span>{r.catno}</span>}
                    {r.year && <span>{r.year}</span>}
                    {r.country && <span>{r.country}</span>}
                  </div>
                  <div className="rec-meta">{(r.style ?? r.genre ?? []).slice(0, 3).join(" · ")}</div>
                </div>
                <div className="rec-side stack" style={{ gap: 6, alignItems: "flex-end" }}>
                  {owned.has(r.id) && <span className="badge ok">Sammlung</span>}
                  {r.type === "release" && (
                    <button
                      className="icon-btn"
                      style={{ color: wanted.has(r.id) ? "var(--accent)" : undefined }}
                      aria-label="Zur Wantlist"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wanted.has(r.id)) return;
                        haptic(12);
                        addWant(r.id).then(() => toast("Zur Wantlist hinzugefügt"), (err) => toast(err.message));
                      }}
                    >
                      <IconHeart />
                    </button>
                  )}
                  {r.community && <span className="sub">{r.community.want} wollen</span>}
                </div>
              </div>
            );
          })}
        </div>
        {loading && page === 1 && <SkeletonRows />}
        {!loading && hasQuery && results.length === 0 && <Empty title="Nichts gefunden">Anders schreiben oder Filter entfernen.</Empty>}
        {!hasQuery && <Empty title="Die ganze Discogs-Datenbank">Nach Artist, Titel oder Katalognummer suchen. Filter für Genre, Style, Label, Jahr und Land sind oben.</Empty>}
        {pagination && pagination.page < pagination.pages && !loading && (
          <button className="btn block" onClick={() => update({ page: String(page + 1) })}>
            Mehr laden ({pagination.items.toLocaleString("de-DE")} Treffer)
          </button>
        )}
      </div>
    </>
  );
}
