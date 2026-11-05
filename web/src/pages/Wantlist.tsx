import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { loadPriceInfo } from "../lib/prices";
import { fetchMarketStats, fetchMissingDetails, syncWants } from "../lib/sync";
import { dismissRepress, repressNews } from "../lib/repress";
import { money } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { DealDot, Empty, RecordRow, Sheet, SkeletonRows, useDebounced } from "../components/bits";
import { IconCart, IconCoin, IconFolder, IconMore, IconRows, IconSearch, IconSync } from "../components/icons";
import { matchesQuery } from "../../../shared/textSearch";
import { stripFolder } from "../../../shared/folders";
import { FolderBar, FolderManager, inPick, useFolderRecords, useFolderTabs } from "../components/Folders";
import { ActiveChips, AlphaIndex, ChipGroup, FilterGroup, FilterButton, letterOf, MenuSheet, SectionList, sectionsOf, SortButton, SortSheet, sortKey, usePersisted, type SortOption, type SortState } from "../components/ui";

const SORTS: SortOption[] = [
  { id: "deal", label: "Beste Deals", dirs: ["Lohnendste zuerst", "Lohnendste zuletzt"], defaultDir: "desc" },
  { id: "added", label: "Hinzugefügt", dirs: ["Neueste zuerst", "Älteste zuerst"], defaultDir: "desc" },
  { id: "price", label: "Preis", dirs: ["Teuerste zuerst", "Günstigste zuerst"], defaultDir: "asc" },
  { id: "forsale", label: "Angebote", dirs: ["Meiste zuerst", "Wenigste zuerst"], defaultDir: "desc" },
  { id: "rarity", label: "Seltenheit", dirs: ["Seltenste zuerst", "Häufigste zuerst"], defaultDir: "desc" },
  { id: "rating", label: "Deine Priorität", dirs: ["Höchste zuerst", "Niedrigste zuerst"], defaultDir: "desc" },
  { id: "artist", label: "Artist", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "label", label: "Label", dirs: ["Z – A", "A – Z"], defaultDir: "asc" },
  { id: "year", label: "Erscheinungsjahr", dirs: ["Neueste zuerst", "Älteste zuerst"], defaultDir: "desc" },
];

interface Filters {
  deal: string[]; // green | target | cheaper | hot
  available: boolean;
  hideOwned: boolean;
  atFriends: boolean;
  maxPrice: string;
  styles: string[];
  decades: string[];
}
const NO_FILTERS: Filters = { deal: [], available: false, hideOwned: false, atFriends: false, maxPrice: "", styles: [], decades: [] };
const DEAL_LABEL: Record<string, string> = { green: "Unter Marktwert", target: "Unter Wunschpreis", cheaper: "Günstiger geworden", hot: "Selten & gefragt" };
const decadeOf = (y: number) => (y ? `${Math.floor(y / 10) * 10}er` : "Ohne Jahr");

export default function Wantlist() {
  const repress = useLiveQuery(async () => new Map((await repressNews()).map((n) => [n.wantId, n])), []);
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 180);
  const [sort, setSort] = usePersisted<SortState>("want-sort", { id: "added", dir: "desc" });
  const [f, setF] = usePersisted<Filters>("want-filter", NO_FILTERS);
  const [sheet, setSheet] = useState<"sort" | "filter" | "more" | null>(null);
  const jobs = useStore((s) => s.jobs);
  const toolbar = useRef<HTMLDivElement>(null);
  const [toolbarH, setToolbarH] = useState(0);
  useLayoutEffect(() => {
    const el = toolbar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = useLiveQuery(async () => {
    const wants = await db.wants.toArray();
    const ids = wants.map((w) => w.releaseId);
    const [rels, stats, owned] = await Promise.all([db.releases.bulkGet(ids), db.marketStats.bulkGet(ids), db.collection.where("releaseId").anyOf(ids).toArray()]);
    const ownedSet = new Set(owned.map((o) => o.releaseId));
    const info = await loadPriceInfo(ids);
    const fi = (await db.friendItems.where("releaseId").anyOf(ids).toArray()).filter((x) => x.kind === "coll");
    const atFriends = new Map<number, string[]>();
    fi.forEach((x) => atFriends.set(x.releaseId, [...(atFriends.get(x.releaseId) ?? []), x.username]));
    return wants.map((w, i) => ({ w, r: rels[i]!, s: stats[i], p: info.get(w.releaseId)!, owned: ownedSet.has(w.releaseId), friends: atFriends.get(w.releaseId) ?? [] })).filter((x) => x.r);
  });
  const recs = useFolderRecords("want");
  const { names: folderNames } = useFolderTabs("want", recs);
  const [folderSel, setFolderSel] = usePersisted<{ f: string }>("want-folder", { f: "" });
  const folder = folderSel.f === "-" || folderNames.some((n) => n === folderSel.f) ? folderSel.f : "";
  const [folderSheet, setFolderSheet] = useState<{ start: string | null } | null>(null);
  const data = useMemo(() => {
    if (!all || !folder || !recs) return all;
    const of = new Map(recs.map((r) => [r.id, r.folder]));
    return all.filter((x) => inPick(of.get(x.r.id), folder));
  }, [all, recs, folder]);

  const facets = useMemo(() => {
    const count = (vals: string[]) => {
      const m = new Map<string, number>();
      vals.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      styles: count((data ?? []).flatMap((d) => d.r.styles)),
      decades: count((data ?? []).map((d) => decadeOf(d.r.year))).sort((a, b) => a[0].localeCompare(b[0])),
      deal: {
        green: data?.filter((d) => d.p.deal.ampel === "green").length ?? 0,
        target: data?.filter((d) => d.p.deal.underTarget).length ?? 0,
        cheaper: data?.filter((d) => (d.p.deal.change ?? 0) < -0.5).length ?? 0,
        hot: data?.filter((d) => d.p.deal.urgency === "hot").length ?? 0,
      } as Record<string, number>,
    };
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const mp = Number(f.maxPrice.replace(",", ".")) || Infinity;
    const out = data.filter(({ r, s, w, p, owned, friends }) => {
      if (dq) {
        const hay = `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${r.styles.join(" ")} ${stripFolder(w.notes)} ${r.year}`;
        if (!matchesQuery(hay, dq)) return false;
      }
      if (f.styles.length && !f.styles.some((st) => r.styles.includes(st))) return false;
      if (f.decades.length && !f.decades.includes(decadeOf(r.year))) return false;
      if (f.available && !(s && s.numForSale > 0)) return false;
      if (f.hideOwned && owned) return false;
      if (f.atFriends && !friends.length) return false;
      if (f.maxPrice && !(s?.lowest != null && s.numForSale > 0 && s.lowest <= mp)) return false;
      if (f.deal.length) {
        const ok = f.deal.some((d) => (d === "green" ? p.deal.ampel === "green" : d === "target" ? p.deal.underTarget : d === "cheaper" ? (p.deal.change ?? 0) < -0.5 : p.deal.urgency === "hot"));
        if (!ok) return false;
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const price = (x: (typeof out)[0]) => (x.s && x.s.numForSale > 0 ? x.s.lowest ?? Infinity : Infinity);
    const rarity = (x: (typeof out)[0]) => {
      const c = x.r.community;
      return c && c.have ? c.want / c.have : 0;
    };
    const by: Record<string, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      deal: (a, b) => a.p.deal.score - b.p.deal.score,
      added: (a, b) => a.w.dateAdded.localeCompare(b.w.dateAdded),
      price: (a, b) => price(a) - price(b),
      forsale: (a, b) => (a.s?.numForSale ?? -1) - (b.s?.numForSale ?? -1),
      rarity: (a, b) => rarity(a) - rarity(b),
      rating: (a, b) => a.w.rating - b.w.rating,
      artist: (a, b) => sortKey(a.r.artist).localeCompare(sortKey(b.r.artist), "de"),
      label: (a, b) => (a.r.labels[0]?.name ?? "").localeCompare(b.r.labels[0]?.name ?? "", "de"),
      year: (a, b) => (a.r.year || 0) - (b.r.year || 0),
    };
    const cmp = by[sort.id] ?? by.added;
    return [...out].sort((a, b) => {
      // Nicht verfügbare beim Preis immer ans Ende
      if (sort.id === "price") {
        const ea = price(a) === Infinity, eb = price(b) === Infinity;
        if (ea !== eb) return ea ? 1 : -1;
        if (ea && eb) return 0;
      }
      return cmp(a, b) * dir || price(a) - price(b);
    });
  }, [data, dq, f, sort]);

  type Item = (typeof list)[0];
  const sectionKey = useMemo((): ((x: Item) => string) | null => {
    switch (sort.id) {
      case "artist":
        return (x) => letterOf(x.r.artist);
      case "label":
        return (x) => x.r.labels[0]?.name.replace(/\s\(\d+\)$/, "") ?? "Ohne Label";
      case "year":
        return (x) => decadeOf(x.r.year);
      case "price":
        return (x) => {
          const v = x.s && x.s.numForSale > 0 ? x.s.lowest : null;
          if (v == null) return x.s ? "Gerade nicht verfügbar" : "Noch kein Preis";
          return v < 10 ? "unter 10 €" : v < 20 ? "10 – 20 €" : v < 35 ? "20 – 35 €" : v < 60 ? "35 – 60 €" : "über 60 €";
        };
      case "deal":
        return (x) => (x.p.deal.ampel === "green" || x.p.deal.underTarget ? "Gute Gelegenheiten" : x.p.deal.urgency === "hot" ? "Selten & gefragt" : x.p.deal.ampel === "red" ? "Gerade teuer" : x.s?.numForSale === 0 ? "Nicht verfügbar" : "Weitere");
      case "rating":
        return (x) => (x.w.rating ? "★".repeat(x.w.rating) : "Ohne Priorität");
      case "added":
        return (x) => new Date(x.w.dateAdded).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
      default:
        return null;
    }
  }, [sort.id]);
  const sections = useMemo(() => sectionsOf(list, sectionKey), [list, sectionKey]);
  const letters = sort.id === "artist" ? sections.map(([k]) => k) : [];

  const chips = [
    ...f.deal.map((d) => ({ key: `deal${d}`, label: DEAL_LABEL[d], remove: () => setF((p) => ({ ...p, deal: p.deal.filter((x) => x !== d) })) })),
    ...(f.maxPrice ? [{ key: "mp", label: `bis ${f.maxPrice} €`, remove: () => setF((p) => ({ ...p, maxPrice: "" })) }] : []),
    ...(f.hideOwned ? [{ key: "own", label: "Ohne vorhandene", remove: () => setF((p) => ({ ...p, hideOwned: false })) }] : []),
    ...f.styles.map((s) => ({ key: `s${s}`, label: s, remove: () => setF((p) => ({ ...p, styles: p.styles.filter((x) => x !== s) })) })),
    ...f.decades.map((s) => ({ key: `d${s}`, label: s, remove: () => setF((p) => ({ ...p, decades: p.decades.filter((x) => x !== s) })) })),
  ];
  const filterCount = chips.length + (f.available ? 1 : 0) + (f.atFriends ? 1 : 0);
  const available = data?.filter((d) => d.s && d.s.numForSale > 0) ?? [];
  const total = available.reduce((sum, d) => sum + (d.s?.lowest ?? 0), 0);
  const priced = data?.filter((d) => d.s).length ?? 0;
  const loading = Boolean(jobs.stats);

  const loadPrices = () =>
    fetchMarketStats(list.map((x) => x.r.id)).then(
      () => toast("Preise aktualisiert"),
      (e) => toast((e as Error).message),
    );

  const toggleDeal = (d: string) => setF((p) => ({ ...p, deal: p.deal.includes(d) ? p.deal.filter((x) => x !== d) : [...p.deal, d] }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Wantlist</h1>
          <div className="sub">{data ? `${data.length} Platten${available.length ? ` · ${available.length} verfügbar` : ""}` : " "}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Link to="/shop" viewTransition className="btn small primary">
            <IconCart /> Shoppen
          </Link>
          <button className="icon-btn round" onClick={() => setSheet("more")} aria-label="Mehr">
            <IconMore />
          </button>
        </div>
      </div>
      <FolderBar kind="want" recs={recs} value={folder} onChange={(f) => setFolderSel({ f })} onManage={() => setFolderSheet({ start: null })} />
      <FolderManager kind="want" open={folderSheet !== null} onClose={() => setFolderSheet(null)} recs={recs} startWith={folderSheet?.start} onShow={(f) => setFolderSel({ f })} key={folderSheet?.start ?? "list"} />

      {repress && repress.size > 0 && (
        <div className="page" style={{ paddingTop: 4, paddingBottom: 0 }}>
          <div className="repress-card">
            <span className="eyebrow">Repress-Alarm</span>
            <b>{repress.size === 1 ? "Eine Platte von deiner Wantlist wurde neu gepresst" : `${repress.size} Platten von deiner Wantlist wurden neu gepresst`}</b>
            <div className="repress-list">
              {[...repress.values()].slice(0, 5).map((n) => (
                <div key={n.wantId} className="repress-row">
                  <Link to={`/release/${n.version.id}`} viewTransition style={{ color: "inherit", minWidth: 0, flex: 1 }}>
                    <span className="repress-t">{n.version.title}</span>
                    <span className="repress-m mono">{[n.version.label, n.version.catno, n.version.country, String(n.version.released ?? "").slice(0, 4)].filter(Boolean).join(" · ")}</span>
                  </Link>
                  <button className="hint-x ghost" onClick={() => void dismissRepress(n.wantId)} aria-label="Ausblenden">
                    Okay
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="page" style={{ paddingTop: 4, paddingBottom: 0 }}>
          <div className="summary-strip">
            <button className="stat press" onClick={() => setSort({ id: "price", dir: "asc" })} style={{ textAlign: "left", border: 0 }}>
              <b>{priced ? money(total) : "–"}</b>
              <span>{priced ? `ab, für ${available.length === 1 ? "die verfügbare" : `alle ${available.length} verfügbaren`}` : "Preise folgen"}</span>
            </button>
            {(["green", "target", "cheaper", "hot"] as const).map((d) => (
              <button key={d} className={`stat press ${f.deal.includes(d) ? "on" : ""}`} onClick={() => toggleDeal(d)} style={{ textAlign: "left", border: 0, outline: f.deal.includes(d) ? "2px solid var(--accent)" : undefined }}>
                <b style={{ color: facets.deal[d] ? (d === "hot" ? "var(--bad)" : "var(--ok)") : undefined }}>{facets.deal[d]}</b>
                <span>{DEAL_LABEL[d]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar" ref={toolbar} data-title={folder && folder !== "-" ? folder : "Wantlist"}>
        <div className="search-bar">
          <IconSearch />
          <input className="input" type="search" placeholder="In der Wantlist suchen …" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        </div>
        <div className="toolbar-row">
          <SortButton options={SORTS} value={sort} onClick={() => setSheet("sort")} />
          <FilterButton count={filterCount} onClick={() => setSheet("filter")} />
          <span className="tool-sep" />
          <button className={`tool-btn ${f.available ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, available: !p.available }))}>
            Verfügbar
          </button>
          {data?.some((d) => d.friends.length) && (
            <button className={`tool-btn ${f.atFriends ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, atFriends: !p.atFriends }))}>
              Bei Freunden
            </button>
          )}
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

      <div className="page" style={{ paddingTop: 0, paddingRight: letters.length >= 6 ? 24 : undefined }}>
        {(["price", "forsale", "deal"].includes(sort.id) || f.available || f.maxPrice || f.deal.length > 0) && priced === 0 && data && data.length > 0 && (
          <div className="card row" style={{ background: "var(--accent-soft)", marginBottom: 8 }}>
            <IconCoin />
            <span className="sub" style={{ flex: 1 }}>Für diese Ansicht braucht die App Marktpreise. Sie kommen beim nächsten Sync automatisch.</span>
            <button className="btn small primary" onClick={loadPrices} disabled={loading}>
              {loading ? "Lädt …" : "Jetzt laden"}
            </button>
          </div>
        )}
        {!data && <SkeletonRows />}
        <SectionList
          sections={sections}
          stickyTop={toolbarH}
          render={({ r, s, p, owned, friends }: Item) => (
            <RecordRow
              key={r.id}
              r={r}
              side={
                <div className="stack" style={{ gap: 3, alignItems: "flex-end" }}>
                  {s ? (
                    s.numForSale > 0 ? (
                      <>
                        <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          <DealDot a={p.deal.ampel} />
                          <span className="bpm" style={{ fontSize: 15 }}>{money(s.lowest, s.currency)}</span>
                        </span>
                        <span className="tiny">{s.numForSale} Angebote</span>
                      </>
                    ) : (
                      <span className="tiny">nicht verfügbar</span>
                    )
                  ) : null}
                  {p.deal.underTarget && <span className="badge ok">Wunschpreis</span>}
                  {p.deal.urgency === "hot" && <span className="badge bad">selten</span>}
                  {(p.deal.change ?? 0) < -0.5 && <span className="badge accent">↓ {money(-(p.deal.change ?? 0))}</span>}
                  {repress?.has(r.id) && <span className="badge accent">Repress {String(repress.get(r.id)!.version.released ?? "").slice(0, 4)}</span>}
                  {owned && <span className="badge ok">schon da</span>}
                  {friends.length > 0 && <span className="badge" style={{ background: "rgba(191,90,242,.16)", color: "#bf5af2" }}>bei {friends[0]}{friends.length > 1 ? ` +${friends.length - 1}` : ""}</span>}
                </div>
              }
            />
          )}
        />
        <AlphaIndex letters={letters} offset={toolbarH} />
        {all && all.length > 0 && data && data.length === 0 && (
          <Empty title="Ordner ist leer" action={<button className="btn tinted" onClick={() => setFolderSheet({ start: folder === "-" ? null : folder })}>Platten einsortieren</button>}>
            In diesem Ordner liegt noch nichts.
          </Empty>
        )}
        {all && all.length === 0 && <Empty title="Wantlist ist leer">Tippe in der Suche auf das Herz, um Platten zu merken.</Empty>}
        {data && data.length > 0 && list.length === 0 && (
          <Empty title="Nichts gefunden" action={<button className="btn tinted" onClick={() => (setQ(""), setF(NO_FILTERS))}>Suche und Filter zurücksetzen</button>}>
            Keine Platte passt zu Suche und Filtern.
          </Empty>
        )}
      </div>

      <SortSheet open={sheet === "sort"} onClose={() => setSheet(null)} options={SORTS} value={sort} onChange={setSort} />
      <MenuSheet
        open={sheet === "more"}
        onClose={() => setSheet(null)}
        items={[
          { label: priced ? "Preise aktualisieren" : "Preise laden", icon: <IconCoin />, onClick: loadPrices, disabled: loading },
          { label: "Ordner", icon: <IconFolder />, onClick: () => setFolderSheet({ start: null }) },
          { label: "Wantlist synchronisieren", icon: <IconSync />, onClick: () => syncWants().then(() => toast("Wantlist aktualisiert"), (e) => toast(e.message)) },
          { label: "Fehlende Details laden", icon: <IconRows />, onClick: () => fetchMissingDetails("wants").catch((e) => toast(e.message)) },
          { label: "Zum Händler-Optimierer", icon: <IconCart />, onClick: () => nav("/shop", { viewTransition: true }) },
        ]}
      />
      <Sheet open={sheet === "filter"} onClose={() => setSheet(null)}>
        <div className="sheet-title">
          <h3>Filter</h3>
          <button className="text-btn" onClick={() => setF(NO_FILTERS)} disabled={filterCount === 0}>
            Zurücksetzen
          </button>
        </div>
        <FilterGroup title="Preis & Gelegenheiten">
          <div className="chip-wrap">
            {(["green", "target", "cheaper", "hot"] as const).map((d) => (
              <button key={d} className={`chip ${f.deal.includes(d) ? "on" : ""}`} onClick={() => toggleDeal(d)}>
                {DEAL_LABEL[d]} <span className="sub">{facets.deal[d]}</span>
              </button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup title="Höchstpreis pro Platte">
          <div className="chip-wrap" style={{ marginBottom: 10 }}>
            {["10", "15", "20", "30", "50"].map((v) => (
              <button key={v} className={`chip ${f.maxPrice === v ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, maxPrice: p.maxPrice === v ? "" : v }))}>
                bis {v} €
              </button>
            ))}
          </div>
          <input className="input" inputMode="decimal" placeholder="eigener Betrag in €" value={f.maxPrice} onChange={(e) => setF((p) => ({ ...p, maxPrice: e.target.value }))} />
        </FilterGroup>
        <FilterGroup title="Verfügbarkeit">
          <div className="chip-wrap">
            <button className={`chip ${f.available ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, available: !p.available }))}>
              Nur mit Angeboten
            </button>
            <button className={`chip ${f.hideOwned ? "on" : ""}`} onClick={() => setF((p) => ({ ...p, hideOwned: !p.hideOwned }))}>
              Schon vorhandene ausblenden
            </button>
          </div>
        </FilterGroup>
        <ChipGroup title="Styles" values={facets.styles} selected={f.styles} onToggle={(v) => setF((p) => ({ ...p, styles: p.styles.includes(v) ? p.styles.filter((x) => x !== v) : [...p.styles, v] }))} />
        <ChipGroup title="Jahrzehnt" values={facets.decades} selected={f.decades} onToggle={(v) => setF((p) => ({ ...p, decades: p.decades.includes(v) ? p.decades.filter((x) => x !== v) : [...p.decades, v] }))} />
        <div className="sheet-footer">
          <button className="btn primary block lg" onClick={() => setSheet(null)}>
            {list.length} Platten anzeigen
          </button>
        </div>
      </Sheet>
    </>
  );
}
