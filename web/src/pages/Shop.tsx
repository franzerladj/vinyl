import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, setKV } from "../lib/db";
import { money } from "../lib/format";
import { bookmarkletCode } from "../lib/bookmarklet";
import { loadPriceInfo, scanFavorites, scanSeller, toggleFavorite } from "../lib/prices";
import { planBudget } from "../../../shared/deals";
import { toast } from "../lib/store";
import { Cover, DealDot, RecordRow, Seg } from "../components/bits";
import { IconExternal, IconX } from "../components/icons";
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

async function importListings(list: Listing[]) {
  const now = Date.now();
  await db.listings.bulkPut(list.map((l) => ({ ...l, importedAt: now })));
}

export default function Shop() {
  const [tab, setTab] = useState<"basket" | "budget" | "sellers" | "import">("basket");
  const [budget, setBudget] = useState("");
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
    return b > 0 ? planBudget(budgetItems.map((x) => ({ ...x, score: x.deal.score })), b, Number(settings.firstItem) || 0) : null;
  }, [budget, budgetItems, settings.firstItem]);
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
            ["budget", "Budget"],
            ["sellers", "Händler"],
            ["import", "Angebote"],
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
            <div className="empty">Noch keine Angebote. Unter „Angebote“ geht es los, oder Lieblingshändler unter „Händler“ anlegen.</div>
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
              <span className="sub">Die App durchsucht ihr Inventar nach jedem Sync automatisch nach deinen Wants. Dafür braucht es kein Lesezeichen.</span>
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
              <div className="row">
                <input className="input" placeholder="Händlername hinzufügen" value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
                <button
                  className="btn"
                  onClick={async () => {
                    const n = sellerName.trim();
                    if (!n) return;
                    if (!favorites.some((f) => f.name === n)) await toggleFavorite(n);
                    await doScan(n);
                  }}
                >
                  + Prüfen
                </button>
              </div>
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
                      {fav ? "★" : "☆"}
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
              <span className="sub">Die App wählt die lohnendsten Wants: gute Preise laut Ampel, unter Wunschpreis, selten und gefragt, deine Bewertung. Pro Platte rechnet sie mit {money(Number(settings.firstItem) || 0)} Versand, weil die günstigsten Angebote meist bei verschiedenen Händlern liegen.</span>
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
                <button className="btn" onClick={() => doScan()}>
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

