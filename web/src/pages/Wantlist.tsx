import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { fetchMarketStats, fetchMissingDetails, syncWants } from "../lib/sync";
import { money } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { RecordRow, useDebounced } from "../components/bits";
import { IconCart, IconSearch } from "../components/icons";

type Sort = "added" | "artist" | "title" | "year" | "label" | "price" | "forsale" | "rating";

export default function Wantlist() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 200);
  const [sort, setSort] = useState<Sort>("added");
  const [style, setStyle] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");
  const [group, setGroup] = useState<"none" | "label" | "style" | "decade">("none");
  const jobs = useStore((s) => s.jobs);

  const data = useLiveQuery(async () => {
    const wants = await db.wants.toArray();
    const ids = wants.map((w) => w.releaseId);
    const [rels, stats, owned] = await Promise.all([db.releases.bulkGet(ids), db.marketStats.bulkGet(ids), db.collection.where("releaseId").anyOf(ids).toArray()]);
    const ownedSet = new Set(owned.map((o) => o.releaseId));
    return wants.map((w, i) => ({ w, r: rels[i]!, s: stats[i], owned: ownedSet.has(w.releaseId) })).filter((x) => x.r);
  });

  const styles = useMemo(() => {
    const c = new Map<string, number>();
    data?.forEach((d) => d.r.styles.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const mp = Number(maxPrice.replace(",", ".")) || Infinity;
    const out = data.filter(({ r, s, w }) => {
      if (dq) {
        const hay = `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${r.styles.join(" ")} ${w.notes ?? ""}`.toLowerCase();
        if (!dq.split(/\s+/).every((x) => hay.includes(x))) return false;
      }
      if (style && !r.styles.includes(style)) return false;
      if (onlyAvailable && !(s && s.numForSale > 0)) return false;
      if (maxPrice && !(s?.lowest != null && s.lowest <= mp)) return false;
      return true;
    });
    const price = (x: (typeof out)[0]) => x.s?.lowest ?? Infinity;
    const cmp: Record<Sort, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
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
  }, [data, dq, style, onlyAvailable, maxPrice, sort]);

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
        <Link to="/shop" className="btn small primary">
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
        {(sort === "price" || sort === "forsale" || onlyAvailable || maxPrice) && priced === 0 && (
          <div className="card sub">Für diese Sortierung braucht die App Marktpreise. Tippe auf „Preise laden“ (ca. 1 Sekunde pro Platte).</div>
        )}

        {grouped.map(([g, items]) => (
          <div key={g}>
            {g && (
              <h3>
                {g} <span className="sub">{items.length}</span>
              </h3>
            )}
            <div className="list">
              {items.slice(0, 400).map(({ r, s, owned }) => (
                <RecordRow
                  key={r.id}
                  r={r}
                  side={
                    <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
                      {s ? (
                        s.numForSale > 0 ? (
                          <>
                            <b>{money(s.lowest, s.currency)}</b>
                            <span className="sub">{s.numForSale} Angebote</span>
                          </>
                        ) : (
                          <span className="badge bad">nicht verfügbar</span>
                        )
                      ) : null}
                      {owned && <span className="badge ok">schon da</span>}
                    </div>
                  }
                />
              ))}
            </div>
          </div>
        ))}
        {data && data.length === 0 && <div className="empty">Deine Wantlist ist leer oder noch nicht geladen.</div>}
      </div>
    </>
  );
}
