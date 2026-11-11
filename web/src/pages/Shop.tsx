import { NavBar } from "../components/ui";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV } from "../lib/db";
import { money } from "../lib/format";
import { loadPriceInfo, scanFavorites, scanSeller, toggleFavorite } from "../lib/prices";
import { planBudget } from "../../../shared/deals";
import { toast } from "../lib/store";
import { Cover, DealDot, DiscogsCredit, RecordRow, Seg } from "../components/bits";
import { IconCoin, IconExternal, IconStar, IconX } from "../components/icons";
import { optimizeBasket, rankSellers, type Grade, type Listing, type OptimizeOptions } from "../../../shared/optimizer";
import { DEFAULT_SHIP, estimateShipping, type ShipConfig } from "../../../shared/shipping";
import { ShippingEditor } from "../components/ShippingEditor";

interface ShopSettings {
  firstItem: number;
  perExtraItem: number;
  maxPrice: string;
  minRating: string;
  minCondition: Grade | "";
  maxSellers: string;
  ship: ShipConfig;
}
const DEFAULTS: ShopSettings = { firstItem: 7, perExtraItem: 1.5, maxPrice: "", minRating: "98", minCondition: "VG+", maxSellers: "", ship: DEFAULT_SHIP };

/** Händlernamen aus Eingabe oder kopierten Shop-Links lesen (discogs.com/seller/NAME/profile) */
export function parseSellerNames(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x.match(/discogs\.com\/(?:[a-z]{2}\/)?(?:seller|user|shop)\/([^/?#]+)/i)?.[1] ?? (x.includes("/") ? "" : x))
        .map((x) => decodeURIComponent(x))
        .filter((x) => /^[\w.\-]{2,40}$/.test(x)),
    ),
  ];
}


export default function Shop() {
  const [tab, setTab] = useState<"basket" | "budget" | "sellers">("basket");
  const [budget, setBudget] = useState("");
  const [settings, setSettings] = useState<ShopSettings>(DEFAULTS);
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

  const data = useLiveQuery(async () => {
    const [listings, wants, owned] = await Promise.all([db.listings.toArray(), db.wants.toCollection().primaryKeys(), db.collection.toArray()]);
    const ownedSet = new Set(owned.map((o) => o.releaseId));
    const wantSet = new Set(wants.filter((w) => !ownedSet.has(w)));
    const rels = new Map((await db.releases.bulkGet([...new Set(listings.map((l) => l.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
    return { listings: listings.filter((l) => wantSet.has(l.releaseId)), wantCount: wantSet.size, rels, newest: Math.max(0, ...listings.map((l) => l.importedAt)) };
  });

  const opts: OptimizeOptions = useMemo(
    () => ({
      shipping: { firstItem: settings.ship.rates.eu.first, perExtraItem: settings.ship.rates.eu.extra, regions: settings.ship },
      maxPricePerItem: settings.maxPrice ? Number(settings.maxPrice.replace(",", ".")) : undefined,
      minSellerRating: settings.minRating ? Number(settings.minRating) : undefined,
      minCondition: settings.minCondition || undefined,
      maxSellers: settings.maxSellers ? Number(settings.maxSellers) : undefined,
      wanted: data ? [...new Set(data.listings.map((l) => l.releaseId))].filter((id) => !excluded.has(id)) : [],
    }),
    [settings, data, excluded],
  );
  const favorites = useLiveQuery(async () => (await db.sellers.toArray()).filter((f) => f.favorite), [], []);
  const budgetItems = useLiveQuery(async () => {
    const wants = await db.wants.toArray();
    const ids = wants.map((w) => w.releaseId);
    const [info, rels] = await Promise.all([loadPriceInfo(ids), db.releases.bulkGet(ids)]);
    return wants
      .map((w, i) => ({ id: w.releaseId, r: rels[i]!, price: info.get(w.releaseId)?.stat?.lowest ?? 0, deal: info.get(w.releaseId)!.deal, stars: w.rating, n: info.get(w.releaseId)?.stat?.numForSale ?? 0 }))
      .filter((x) => x.r && x.price > 0 && x.n > 0);
  }, [], []);
  const plan = useMemo(() => {
    const b = Number(budget.replace(",", "."));
    return b > 0 ? planBudget(budgetItems.map((x) => ({ ...x, score: x.deal.score })), b, settings.ship.rates.eu.first) : null;
  }, [budget, budgetItems, settings.ship]);
  const result = useMemo(() => (data?.listings.length ? optimizeBasket(data.listings, opts) : null), [data, opts]);
  const ranking = useMemo(() => (data?.listings.length ? rankSellers(data.listings, opts).slice(0, 50) : []), [data, opts]);

  const doScan = async (name?: string) => {
    const seller = (name ?? sellerName).trim();
    if (!seller) return;
    try {
      const n = await scanSeller(seller);
      toast(`${n} Wants bei ${seller} gefunden`);
      setSellerName("");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <NavBar backLabel="Zurück" title="Shoppen" titleOnScroll />
      <div className="page-head" style={{ paddingTop: 0 }}>
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
            ["budget", "Budget"],
            ["sellers", "Händler"],
          ]}
          onChange={setTab}
        />

        {tab !== "sellers" && (
          <details className="card">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Versand & Regeln</summary>
            <div style={{ marginTop: 12 }}>
              <ShippingEditor value={settings.ship} onChange={(ship) => upd({ ship })} />
            </div>
            <b style={{ display: "block", marginTop: 16 }}>Regeln</b>
            <div className="grid2" style={{ marginTop: 8 }}>
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
            <p className="sub">Preise in der Währung, die du bei Discogs eingestellt hast.</p>
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
            <div className="stack" style={{ marginTop: 8 }}>
              <div style={{ textAlign: "center", padding: "12px 12px 4px" }}>
                <b style={{ fontSize: 19 }}>So findest du die besten Händler</b>
                <p className="sub" style={{ margin: "6px 0 0" }}>Crate braucht Angebote, um den günstigsten Warenkorb mit möglichst wenig Versand zu berechnen.</p>
              </div>
              <div className="group">
                {(
                  [
                    ["sellers", <IconStar key="s" />, "", "Lieblingshändler anlegen", "Ihr Inventar wird nach jedem Sync automatisch durchsucht"],
                    ["sellers", <IconExternal key="e" />, "", "Shop-Link einfügen", "Auf Discogs beim Händler „Teilen“ antippen und den Link hier einfügen"],
                    ["budget", <IconCoin key="c" />, "", "Budget planen", "Was bekomme ich für mein Geld? Geht auch ohne Angebote"],
                  ] as const
                ).map(([t, i, , l, d]) => (
                  <button key={t} className="set-row press" onClick={() => setTab(t)}>
                    <span className="ico">{i}</span>
                    <span className="label">
                      {l}
                      <small>{d}</small>
                    </span>
                    <span className="chev" style={{ color: "var(--text-3)" }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          ))}

        {tab === "sellers" && (
          <>
            <div className="card stack">
              <div className="row">
                <b>Lieblingshändler</b>
                <span className="spacer" />
                {favorites.length > 0 && (
                  <button className="btn small tinted" onClick={() => scanFavorites(0).then((n) => toast(`${n} Treffer bei deinen Lieblingshändlern`), (e) => toast(e.message))}>
                    Alle prüfen
                  </button>
                )}
              </div>
              <span className="sub">Die App durchsucht ihr Inventar über die offizielle Discogs-Schnittstelle nach jedem Sync automatisch nach deinen Wants und rechnet daraus den Warenkorb.</span>
              {favorites.map((f) => (
                <div key={f.name} className="row">
                  <span style={{ flex: 1, minWidth: 0 }} className="rec-title">
                    ★ {f.name}
                  </span>
                  <span className="tiny">{f.lastScan ? `${f.lastHits ?? 0} Treffer · ${new Date(f.lastScan).toLocaleDateString("de-DE")}` : "noch nicht geprüft"}</span>
                  <button className="icon-btn" aria-label="Entfernen" onClick={() => toggleFavorite(f.name)}>
                    <IconX />
                  </button>
                </div>
              ))}
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const names = parseSellerNames(sellerName);
                  if (!names.length) return toast("Kein Händlername oder Shop-Link erkannt");
                  setSellerName("");
                  for (const n of names) {
                    if (!favorites.some((f) => f.name === n)) await toggleFavorite(n);
                    await doScan(n);
                  }
                }}
              >
                <input className="input" placeholder="Name oder Shop-Link" value={sellerName} onChange={(e) => setSellerName(e.target.value)} autoCapitalize="off" autoCorrect="off" />
                <button className="btn">+ Prüfen</button>
              </form>
              <span className="tiny">Tipp: Auf discogs.com beim Händler auf „Teilen“ tippen, Link kopieren und hier einfügen. Mehrere gehen auch, mit Komma getrennt.</span>
            </div>
            {ranking.length > 0 && <h3>Wer hat die meisten deiner Wants?</h3>}
            <div className="list">
              {ranking.map((s, i) => {
                const fav = favorites.some((f) => f.name === s.seller);
                return (
                  <div key={s.seller} className="rec">
                    <b style={{ width: 28, color: "var(--text-3)" }}>{i + 1}</b>
                    <div className="rec-main">
                      <div className="rec-title">{s.seller}</div>
                      <div className="rec-meta">
                        <span>{s.items.length} deiner Wants</span>
                        <span>{money(s.total)} inkl. Versand</span>
                        <span>Ø {money(s.total / s.items.length)}/Platte</span>
                        {s.rating ? <span>{s.rating}%</span> : null}
                      </div>
                    </div>
                    <button className="icon-btn" aria-label={fav ? "Kein Lieblingshändler" : "Als Lieblingshändler merken"} onClick={() => toggleFavorite(s.seller)} style={{ color: fav ? "var(--accent)" : "var(--text-3)", fontSize: 20 }}>
                      <IconStar />
                    </button>
                    <a className="icon-btn" href={`https://www.discogs.com/sell/mywants?seller=${encodeURIComponent(s.seller)}`} target="_blank" rel="noreferrer" aria-label="Auf Discogs öffnen">
                      <IconExternal />
                    </a>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "budget" && (
          <>
            <div className="card stack">
              <b>Was bekomme ich für mein Budget?</b>
              <span className="sub">Die App wählt die lohnendsten Wants: gute Preise laut Ampel, unter Wunschpreis, selten und gefragt, deine Bewertung. Pro Platte rechnet sie mit etwa {money(estimateShipping(settings.ship, null, 1))} Versand (EU-Schätzung), weil die günstigsten Angebote meist bei verschiedenen Händlern liegen.</span>
              <div className="row">
                <input className="input" inputMode="decimal" placeholder="Budget in €, z.B. 150" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
            </div>
            {plan && (
              <>
                <div className="grid3">
                  <div className="stat">
                    <b>{plan.picked.length}</b>
                    <span>Platten</span>
                  </div>
                  <div className="stat">
                    <b>{money(plan.total)}</b>
                    <span>geschätzt</span>
                  </div>
                  <div className="stat">
                    <b>{money((Number(budget.replace(",", ".")) || 0) - plan.total)}</b>
                    <span>übrig</span>
                  </div>
                </div>
                <div className="list">
                  {plan.picked.map((x) => (
                    <RecordRow
                      key={x.id}
                      r={x.r}
                      side={
                        <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
                          <span className="row" style={{ gap: 6 }}>
                            <DealDot a={x.deal.ampel} />
                            <span className="bpm" style={{ fontSize: 15 }}>{money(x.price)}</span>
                          </span>
                          {x.deal.reasons[0] && <span className="tiny">{x.deal.reasons[0]}</span>}
                        </div>
                      }
                    />
                  ))}
                </div>
                {plan.picked.length > 0 && (
                  <button className="btn block tinted" onClick={() => setTab("basket")}>
                    Bei möglichst wenigen Händlern zusammen kaufen → Warenkorb
                  </button>
                )}
                {budgetItems.length === 0 && <div className="sub">Für den Budget-Plan braucht die App Marktpreise. Die kommen beim nächsten Sync automatisch, oder in der Wantlist auf „Preise laden“ tippen.</div>}
              </>
            )}
          </>
        )}

        <DiscogsCredit href="https://www.discogs.com/sell/mywants" />
      </div>
    </>
  );
}

