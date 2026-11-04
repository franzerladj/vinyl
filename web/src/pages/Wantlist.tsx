import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { loadPriceInfo } from "../lib/prices";
import { fetchMarketStats, fetchMissingDetails, syncWants } from "../lib/sync";
import { money } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { DealDot, Empty, RecordRow, SkeletonRows, useDebounced } from "../components/bits";
import { IconCart, IconSearch } from "../components/icons";

type Sort = "deal" | "added" | "artist" | "title" | "year" | "label" | "price" | "forsale" | "rating";

export default function Wantlist() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 200);
  const [sort, setSort] = useState<Sort>("added");
  const [style, setStyle] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");
  const [group, setGroup] = useState<"none" | "label" | "style" | "decade">("none");
  const [dealFilter, setDealFilter] = useState<"all" | "green" | "target" | "cheaper" | "hot">("all");
  const jobs = useStore((s) => s.jobs);

  const data = useLiveQuery(async () => {
    const wants = await db.wants.toArray();
    const ids = wants.map((w) => w.releaseId);
    const [rels, stats, owned] = await Promise.all([db.releases.bulkGet(ids), db.marketStats.bulkGet(ids), db.collection.where("releaseId").anyOf(ids).toArray()]);
    const ownedSet = new Set(owned.map((o) => o.releaseId));
    const info = await loadPriceInfo(ids);
    return wants.map((w, i) => ({ w, r: rels[i]!, s: stats[i], p: info.get(w.releaseId)!, owned: ownedSet.has(w.releaseId) })).filter((x) => x.r);
  });

  const styles = useMemo(() => {
    const c = new Map<string, number>();
    data?.forEach((d) => d.r.styles.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const mp = Number(maxPrice.replace(",", ".")) || Infinity;
    const out = data.filter(({ r, s, w, p }) => {
      if (dq) {
        const hay = `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${r.styles.join(" ")} ${w.notes ?? ""}`.toLowerCase();
        if (!dq.split(/\s+/).every((x) => hay.includes(x))) return false;
      }
      if (style && !r.styles.includes(style)) return false;
      if (onlyAvailable && !(s && s.numForSale > 0)) return false;
      if (maxPrice && !(s?.lowest != null && s.lowest <= mp)) return false;
      if (dealFilter === "green" && p.deal.ampel !== "green") return false;
      if (dealFilter === "target" && !p.deal.underTarget) return false;
      if (dealFilter === "cheaper" && !((p.deal.change ?? 0) < -0.5)) return false;
      if (dealFilter === "hot" && p.deal.urgency !== "hot") return false;
      return true;
    });
    const price = (x: (typeof out)[0]) => x.s?.lowest ?? Infinity;
    const cmp: Record<Sort, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      deal: (a, b) => b.p.deal.score - a.p.deal.score || price(a) - price(b),
      added: (a, b) => b.w.dateAdded.localeCompare(a.w.dateAdded),
      artist: (a, b) => a.r.artist.localeCompare(b.r.artist, "de"),
      title: (a, b) => a.r.title.localeCompare(b.r.title, "de"),
      year: (a, b) => (b.r.year || 0) - (a.r.year || 0),
      label: (a, b) => (a.r.labels[0]?.name ?? "").localeCompare(b.r.labels[0]?.name ?? "", "de"),
      price: (a, b) => price(a) - price(b),
      forsale: (a, b) => (b.s?.numForSale ?? -1) - (a.s?.numForSale ?? -1),
      rating: (a, b) => b.w.rating - a.w.rating,
    };
    return [...out].sort(cmp[sort]);
  }, [data, dq, style, onlyAvailable, maxPrice, sort, dealFilter]);

  const grouped = useMemo(() => {
    if (group === "none") return [["", list]] as [string, typeof list][];
    const m = new Map<string, typeof list>();
    for (const x of list) {
      const keys =
        group === "label" ? [x.r.labels[0]?.name.replace(/\s\(\d+\)$/, "") ?? "?"] : group === "style" ? (x.r.styles.length ? x.r.styles.slice(0, 1) : ["Ohne Style"]) : [x.r.year ? `${Math.floor(x.r.year / 10) * 10}er` : "Ohne Jahr"];
      for (const k of keys) m.set(k, [...(m.get(k) ?? []), x]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [list, group]);

  const totalLowest = list.reduce((s, x) => s + (x.s?.lowest ?? 0), 0);
  const priced = data?.filter((d) => d.s).length ?? 0;

  const loadPrices = async () => {
    try {
      await fetchMarketStats(list.map((x) => x.r.id));
      toast("Preise aktualisiert");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Wantlist</h1>
          <div className="sub">
            {list.length} Platten{totalLowest > 0 && ` · ab ${money(totalLowest)} gesamt (ohne Versand)`}
          </div>
        </div>
        <Link to="/shop" viewTransition className="btn small primary">
          <IconCart /> Shoppen
        </Link>
      </div>
      <div className="page stack">
        <div className="search-bar">
          <IconSearch />
          <input className="input" placeholder="In der Wantlist suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chips">
          {(
            [
              ["added", "Neueste"],
              ["deal", "Beste Deals"],
              ["price", "Preis ↑"],
              ["forsale", "Meiste Angebote"],
              ["artist", "Artist"],
              ["label", "Label"],
              ["year", "Jahr"],
              ["title", "Titel"],
              ["rating", "Bewertung"],
            ] as [Sort, string][]
          ).map(([v, l]) => (
            <button key={v} className={`chip ${sort === v ? "on" : ""}`} onClick={() => setSort(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="row">
          <button className={`chip ${onlyAvailable ? "on" : ""}`} onClick={() => setOnlyAvailable(!onlyAvailable)}>
            Nur verfügbar
          </button>
          <input className="input" inputMode="decimal" placeholder="max. Preis €" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} style={{ maxWidth: 130 }} />
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value as typeof group)} style={{ maxWidth: 150 }}>
            <option value="none">Nicht gruppiert</option>
            <option value="label">nach Label</option>
            <option value="style">nach Style</option>
            <option value="decade">nach Jahrzehnt</option>
          </select>
        </div>
        <div className="chips">
          {(
            [
              ["all", "Alle Preise", null],
              ["green", "Unter Marktwert", data?.filter((d) => d.p.deal.ampel === "green").length],
              ["target", "Unter Wunschpreis", data?.filter((d) => d.p.deal.underTarget).length],
              ["cheaper", "Günstiger geworden", data?.filter((d) => (d.p.deal.change ?? 0) < -0.5).length],
              ["hot", "Selten & gefragt", data?.filter((d) => d.p.deal.urgency === "hot").length],
            ] as [typeof dealFilter, string, number | null | undefined][]
          ).map(([v, l, n]) => (
            <button key={v} className={`chip ${dealFilter === v ? "on" : ""}`} onClick={() => setDealFilter(v)}>
              {v !== "all" && <span className="dot" style={{ background: v === "green" || v === "target" ? "var(--ok)" : v === "hot" ? "var(--bad)" : "var(--accent)" }} />}
              {l} {n ? <span className="sub">{n}</span> : null}
            </button>
          ))}
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
        <div className="row wrap">
          <button className="btn small" onClick={loadPrices} disabled={!!jobs.stats}>
            {priced ? "Preise aktualisieren" : "Preise laden"}
          </button>
          <button className="btn small ghost" onClick={() => syncWants().then(() => toast("Wantlist aktualisiert"), (e) => toast(e.message))} disabled={!!jobs.wants}>
            Sync
          </button>
          <button className="btn small ghost" onClick={() => fetchMissingDetails("wants").catch((e) => toast(e.message))}>
            Tracklists laden
          </button>
        </div>
        {(sort === "price" || sort === "forsale" || sort === "deal" || onlyAvailable || maxPrice || dealFilter !== "all") && priced === 0 && (
          <div className="card sub" style={{ background: "var(--accent-soft)" }}>Für diese Sortierung braucht die App Marktpreise. Tippe auf „Preise laden“ (ca. 1 Sekunde pro Platte).</div>
        )}

        {grouped.map(([g, items]) => (
          <div key={g}>
            {g && (
              <h3>
                {g} <span className="sub">{items.length}</span>
              </h3>
            )}
            <div className="list rise">
              {items.slice(0, 400).map(({ r, s, p, owned }) => (
                <RecordRow
                  key={r.id}
                  r={r}
                  side={
                    <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
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
                          <span className="badge bad">nicht verfügbar</span>
                        )
                      ) : null}
                      {p.deal.underTarget && <span className="badge ok">Wunschpreis</span>}
                      {p.deal.urgency === "hot" && <span className="badge bad">zuschlagen</span>}
                      {(p.deal.change ?? 0) < -0.5 && <span className="badge accent">↓ {money(-(p.deal.change ?? 0))}</span>}
                      {owned && <span className="badge ok">schon da</span>}
                    </div>
                  }
                />
              ))}
            </div>
          </div>
        ))}
        {!data && <SkeletonRows />}
        {data && data.length === 0 && <Empty title="Wantlist ist leer">Herz-Symbol in der Suche antippen, um Platten zu merken.</Empty>}
      </div>
    </>
  );
}
