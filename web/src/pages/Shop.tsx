import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { discogs } from "../lib/api";
import { db, getKV, setKV } from "../lib/db";
import { money } from "../lib/format";
import { bookmarkletCode } from "../lib/bookmarklet";
import { jobUpdate, toast } from "../lib/store";
import { Cover, Seg } from "../components/bits";
import { optimizeBasket, rankSellers, type Grade, type Listing, type OptimizeOptions } from "../../../shared/optimizer";

interface ShopSettings {
  firstItem: number;
  perExtraItem: number;
  maxPrice: string;
  minRating: string;
  minCondition: Grade | "";
  maxSellers: string;
}
const DEFAULTS: ShopSettings = { firstItem: 7, perExtraItem: 1.5, maxPrice: "", minRating: "98", minCondition: "VG+", maxSellers: "" };

interface InvPage {
  pagination: { pages: number };
  listings: { id: number; price: { value: number; currency: string }; condition: string; sleeve_condition: string; ships_from: string; seller: { username: string; stats?: { rating?: string } }; release: { id: number; description: string } }[];
}

async function importListings(list: Listing[]) {
  const now = Date.now();
  await db.listings.bulkPut(list.map((l) => ({ ...l, importedAt: now })));
}

export default function Shop() {
  const [tab, setTab] = useState<"basket" | "sellers" | "import">("basket");
  const [settings, setSettings] = useState<ShopSettings>(DEFAULTS);
  const [paste, setPaste] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  useEffect(() => {
    getKV("shopSettings", DEFAULTS).then((s) => setSettings({ ...DEFAULTS, ...s }));
  }, []);
  const upd = (p: Partial<ShopSettings>) => {
    const s = { ...settings, ...p };
    setSettings(s);
    void setKV("shopSettings", s);
  };

  // Empfang vom Lesezeichen-Skript (discogs.com → App)
  useEffect(() => {
    if (!new URLSearchParams(location.search).get("import")) return;
    const onMsg = async (e: MessageEvent) => {
      if (e.origin !== "https://www.discogs.com" || e.data?.type !== "crate-listings") return;
      await importListings(e.data.listings as Listing[]);
      toast(`${e.data.listings.length} Angebote importiert`);
      history.replaceState(null, "", "/shop");
    };
    window.addEventListener("message", onMsg);
    window.opener?.postMessage("crate-ready", "https://www.discogs.com");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const data = useLiveQuery(async () => {
    const [listings, wants, owned] = await Promise.all([db.listings.toArray(), db.wants.toCollection().primaryKeys(), db.collection.toArray()]);
    const ownedSet = new Set(owned.map((o) => o.releaseId));
    const wantSet = new Set(wants.filter((w) => !ownedSet.has(w)));
    const rels = new Map((await db.releases.bulkGet([...new Set(listings.map((l) => l.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
    return { listings: listings.filter((l) => wantSet.has(l.releaseId)), wantCount: wantSet.size, rels, newest: Math.max(0, ...listings.map((l) => l.importedAt)) };
  });

  const opts: OptimizeOptions = useMemo(
    () => ({
      shipping: { firstItem: Number(settings.firstItem) || 0, perExtraItem: Number(settings.perExtraItem) || 0 },
      maxPricePerItem: settings.maxPrice ? Number(settings.maxPrice.replace(",", ".")) : undefined,
      minSellerRating: settings.minRating ? Number(settings.minRating) : undefined,
      minCondition: settings.minCondition || undefined,
      maxSellers: settings.maxSellers ? Number(settings.maxSellers) : undefined,
      wanted: data ? [...new Set(data.listings.map((l) => l.releaseId))].filter((id) => !excluded.has(id)) : [],
    }),
    [settings, data, excluded],
  );
  const result = useMemo(() => (data?.listings.length ? optimizeBasket(data.listings, opts) : null), [data, opts]);
  const ranking = useMemo(() => (data?.listings.length ? rankSellers(data.listings, opts).slice(0, 50) : []), [data, opts]);

  const scanSeller = async () => {
    const seller = sellerName.trim();
    if (!seller) return;
    const wants = new Set(await db.wants.toCollection().primaryKeys());
    const job = `inv-${seller}`;
    jobUpdate(job, { label: `Inventar ${seller}`, done: 0, total: 1 });
    let found = 0;
    try {
      let page = 1;
      let pages = 1;
      const maxPages = 50;
      do {
        const d = await discogs<InvPage>(`/users/${encodeURIComponent(seller)}/inventory?per_page=100&page=${page}&status=For%20Sale`, { background: true });
        pages = Math.min(d.pagination.pages, maxPages);
        const hits: Listing[] = d.listings
          .filter((l) => wants.has(l.release.id))
          .map((l) => ({
            listingId: String(l.id),
            releaseId: l.release.id,
            seller: l.seller.username,
            price: l.price.value,
            condition: l.condition,
            sleeveCondition: l.sleeve_condition,
            shipsFrom: l.ships_from,
            sellerRating: l.seller.stats?.rating ? Number(l.seller.stats.rating) : null,
            title: l.release.description,
          }));
        found += hits.length;
        await importListings(hits);
        jobUpdate(job, { done: page, total: pages });
        page++;
      } while (page <= pages);
      toast(`${found} Wants bei ${seller} gefunden`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      jobUpdate(job, null);
    }
  };

  const doPaste = async () => {
    try {
      const parsed = JSON.parse(paste);
      const list = (Array.isArray(parsed) ? parsed : parsed.listings) as Listing[];
      await importListings(list);
      toast(`${list.length} Angebote importiert`);
      setPaste("");
    } catch {
      toast("Das ist kein gültiger Export aus dem Lesezeichen");
    }
  };

  const appUrl = location.origin;
  const code = bookmarkletCode(appUrl);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shoppen</h1>
          <div className="sub">
            {data?.listings.length ?? 0} Angebote für {new Set(data?.listings.map((l) => l.releaseId)).size} Wants
            {data?.newest ? ` · Stand ${new Date(data.newest).toLocaleString("de-DE")}` : ""}
          </div>
        </div>
      </div>
      <div className="page stack">
        <Seg
          value={tab}
          options={[
            ["basket", "Warenkorb"],
            ["sellers", "Händler"],
            ["import", "Angebote holen"],
          ]}
          onChange={setTab}
        />

        {tab !== "import" && (
          <details className="card">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Regeln & Versand</summary>
            <div className="grid2" style={{ marginTop: 10 }}>
              <label className="field">
                Versand 1. Platte (€)
                <input className="input" inputMode="decimal" value={settings.firstItem} onChange={(e) => upd({ firstItem: Number(e.target.value.replace(",", ".")) })} />
              </label>
              <label className="field">
                je weitere Platte (€)
                <input className="input" inputMode="decimal" value={settings.perExtraItem} onChange={(e) => upd({ perExtraItem: Number(e.target.value.replace(",", ".")) })} />
              </label>
              <label className="field">
                max. Preis pro Platte
                <input className="input" inputMode="decimal" value={settings.maxPrice} onChange={(e) => upd({ maxPrice: e.target.value })} placeholder="egal" />
              </label>
              <label className="field">
                min. Händler-Bewertung %
                <input className="input" inputMode="decimal" value={settings.minRating} onChange={(e) => upd({ minRating: e.target.value })} />
              </label>
              <label className="field">
                min. Zustand (Platte)
                <select className="input" value={settings.minCondition} onChange={(e) => upd({ minCondition: e.target.value as Grade })}>
                  <option value="">egal</option>
                  {["M", "NM", "VG+", "VG", "G+"].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                max. Anzahl Händler
                <input className="input" inputMode="numeric" value={settings.maxSellers} onChange={(e) => upd({ maxSellers: e.target.value })} placeholder="egal" />
              </label>
            </div>
            <p className="sub">Nennt ein Angebot seinen Versand, wird dieser genommen. Sonst gilt dein Wert oben. Preise in der Währung, die du bei Discogs eingestellt hast.</p>
          </details>
        )}

        {tab === "basket" &&
          (result ? (
            <>
              <div className="grid3">
                <div className="stat">
                  <b>{result.itemsCount}</b>
                  <span>Platten</span>
                </div>
                <div className="stat">
                  <b>{result.baskets.length}</b>
                  <span>Händler</span>
                </div>
                <div className="stat">
                  <b>{money(result.total)}</b>
                  <span>inkl. Versand</span>
                </div>
              </div>
              {result.naiveTotal > result.total && (
                <div className="card" style={{ borderColor: "var(--ok)" }}>
                  Gespart gegenüber Einzelkauf beim jeweils billigsten Angebot: <b style={{ color: "var(--ok)" }}>{money(result.naiveTotal - result.total)}</b>
                </div>
              )}
              {result.baskets.map((b) => (
                <div key={b.seller} className="card">
                  <div className="row">
                    <div>
                      <b>{b.seller}</b>
                      <div className="sub">
                        {b.items.length} Platten · {money(b.itemsTotal)} + ca. {money(b.shipping)} Versand
                        {b.items[0]?.sellerRating ? ` · ${b.items[0].sellerRating}%` : ""}
                        {b.items[0]?.shipsFrom ? ` · aus ${b.items[0].shipsFrom}` : ""}
                      </div>
                    </div>
                    <span className="spacer" />
                    <b>{money(b.total)}</b>
                  </div>
                  <div className="list" style={{ marginTop: 6 }}>
                    {b.items.map((l) => {
                      const r = data?.rels.get(l.releaseId);
                      return (
                        <div key={l.listingId} className="rec">
                          <Cover src={r?.thumb} />
                          <div className="rec-main">
                            <div className="rec-title">{r?.title ?? l.title}</div>
                            <div className="rec-artist">{r?.artist}</div>
                            <div className="rec-meta">
                              <span>{l.condition}</span>
                              {l.sleeveCondition && <span>Hülle: {l.sleeveCondition}</span>}
                            </div>
                          </div>
                          <div className="rec-side stack" style={{ gap: 4, alignItems: "flex-end" }}>
                            <b>{money(l.price)}</b>
                            <a className="sub" href={`https://www.discogs.com/sell/item/${l.listingId}`} target="_blank" rel="noreferrer">
                              Angebot ↗
                            </a>
                            <button className="icon-btn sub" onClick={() => setExcluded(new Set([...excluded, l.releaseId]))}>
                              nicht kaufen
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <a className="btn small block" style={{ marginTop: 8 }} href={`https://www.discogs.com/sell/mywants?seller=${encodeURIComponent(b.seller)}`} target="_blank" rel="noreferrer">
                    Alle meine Wants bei {b.seller} ↗
                  </a>
                </div>
              ))}
              {result.missing.length > 0 && <div className="sub">{result.missing.length} Wants ohne passendes Angebot (Filter oder kein Angebot).</div>}
              {excluded.size > 0 && (
                <button className="btn small ghost" onClick={() => setExcluded(new Set())}>
                  {excluded.size} ausgeschlossene wieder aufnehmen
                </button>
              )}
            </>
          ) : (
            <div className="empty">Noch keine Angebote. Unter „Angebote holen“ geht es los.</div>
          ))}

        {tab === "sellers" && (
          <div className="list">
            {ranking.map((s, i) => (
              <div key={s.seller} className="rec">
                <b style={{ width: 28, color: "var(--muted)" }}>{i + 1}</b>
                <div className="rec-main">
                  <div className="rec-title">{s.seller}</div>
                  <div className="rec-meta">
                    <span>{s.items.length} deiner Wants</span>
                    <span>{money(s.total)} inkl. Versand</span>
                    <span>Ø {money(s.total / s.items.length)}/Platte</span>
                    {s.rating && <span>{s.rating}%</span>}
                  </div>
                </div>
                <a className="btn small" href={`https://www.discogs.com/sell/mywants?seller=${encodeURIComponent(s.seller)}`} target="_blank" rel="noreferrer">
                  ↗
                </a>
              </div>
            ))}
          </div>
        )}

        {tab === "import" && (
          <>
            <div className="card stack">
              <b>1. Lesezeichen „Crate holen“ einrichten (einmalig)</b>
              <span className="sub">
                Discogs gibt Marktplatz-Angebote nicht über die API heraus. Das Lesezeichen läuft deshalb direkt auf discogs.com in deinem Browser, liest die Seite „Wantlist im Marktplatz“ und schickt die Angebote hierher.
              </span>
              <span className="sub">
                <b>Am Rechner:</b> diesen Link in die Lesezeichenleiste ziehen:{" "}
                {/* React blockt javascript:-Links im JSX, daher per ref setzen */}
                <a className="badge accent" ref={(el) => el?.setAttribute("href", code)} onClick={(e) => e.preventDefault()}>
                  Crate holen
                </a>
              </span>
              <span className="sub">
                <b>Am Handy:</b> beliebige Seite als Lesezeichen speichern, Lesezeichen bearbeiten, Name „Crate holen“, als Adresse den Code unten einfügen.
              </span>
              <div className="code">{code.slice(0, 160)}…</div>
              <button className="btn small" onClick={() => navigator.clipboard.writeText(code).then(() => toast("Code kopiert"))}>
                Code kopieren
              </button>
            </div>
            <div className="card stack">
              <b>2. Auf Discogs ausführen</b>
              <span className="sub">
                Öffne <a href="https://www.discogs.com/sell/mywants" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>discogs.com/sell/mywants</a> (eingeloggt, gern mit Filter „Versand nach Deutschland“ und Währung EUR). Dann das Lesezeichen antippen. Am Handy: in die Adressleiste „Crate holen“ tippen und das Lesezeichen auswählen.
              </span>
            </div>
            <div className="card stack">
              <b>Alternativ: Inventar eines Händlers prüfen</b>
              <span className="sub">Über die offizielle API. Findet alle deine Wants im Shop eines bestimmten Händlers (bis 5000 Artikel).</span>
              <div className="row">
                <input className="input" placeholder="Händlername" value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
                <button className="btn" onClick={scanSeller}>
                  Prüfen
                </button>
              </div>
            </div>
            <details className="card">
              <summary style={{ cursor: "pointer" }}>Export einfügen (falls Pop-up blockiert war)</summary>
              <textarea className="input" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} style={{ marginTop: 8 }} />
              <button className="btn small" style={{ marginTop: 8 }} onClick={doPaste}>
                Importieren
              </button>
            </details>
            <button
              className="btn small ghost"
              onClick={async () => {
                await db.listings.clear();
                toast("Alte Angebote gelöscht");
              }}
            >
              Alle importierten Angebote löschen
            </button>
          </>
        )}
      </div>
    </>
  );
}

