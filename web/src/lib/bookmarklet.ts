// Lesezeichen-Skript, das auf discogs.com läuft (dort bist du eingeloggt, Cloudflare blockt nicht).
// Es lädt die Seite "Wantlist im Marktplatz" (sell/mywants), liest alle Angebote aus und
// schickt sie per postMessage an die App. Die Discogs-API bietet diese Daten leider nicht an.

function crateCollector(appUrl: string) {
  const num = (s: string | null | undefined) => {
    if (!s) return null;
    const m = s.replace(/\s/g, "").match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
    if (!m) return null;
    let v = m[1];
    if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const parse = (doc: Document) => {
    const out: Record<string, unknown>[] = [];
    doc.querySelectorAll("tr.shortcut_navigable, tr[data-release-id]").forEach((row) => {
      const rid = Number(row.getAttribute("data-release-id") || (row.querySelector('a[href*="/release/"]')?.getAttribute("href") || "").match(/release\/(\d+)/)?.[1]);
      const itemLink = row.querySelector('a.item_description_title, a[href*="/sell/item/"]');
      const listingId = (itemLink?.getAttribute("href") || "").match(/item\/(\d+)/)?.[1];
      const sellerA = row.querySelector('.seller_block a, a[href*="/seller/"]');
      const seller = sellerA?.textContent?.trim() || (sellerA?.getAttribute("href") || "").match(/seller\/([^/]+)/)?.[1];
      const priceEl = row.querySelector(".price");
      const price = num(priceEl?.getAttribute("data-pricevalue")) ?? num(priceEl?.textContent);
      if (!rid || !listingId || !seller || price == null) return;
      const shipText = row.querySelector(".item_shipping")?.textContent || "";
      const sellerText = row.querySelector(".seller_info")?.textContent || "";
      const rating = sellerText.match(/(\d{2,3}(?:[.,]\d)?)\s?%/);
      const ships = sellerText.match(/(?:Ships From|Versand aus|Versand von)\s*:?\s*([A-Za-zÄÖÜäöüß .'-]+)/);
      const cond = row.querySelector(".item_condition")?.textContent?.replace(/\s+/g, " ").trim() || "";
      const media = cond.match(/Media(?: Condition)?:\s*([^:]+?\))/i)?.[1] || cond.match(/\(([A-Z+\- ]{1,6})\)/)?.[0] || "";
      const sleeve = cond.match(/Sleeve(?: Condition)?:\s*([^:]+?(?:\)|$))/i)?.[1] || "";
      out.push({
        listingId,
        releaseId: rid,
        seller: decodeURIComponent(seller),
        price,
        currency: priceEl?.getAttribute("data-currency") || "",
        shipping: /free|kostenlos|gratis/i.test(shipText) ? 0 : num(shipText),
        condition: media.trim(),
        sleeveCondition: sleeve.trim(),
        sellerRating: rating ? parseFloat(rating[1].replace(",", ".")) : null,
        shipsFrom: ships ? ships[1].trim() : "",
        title: itemLink?.textContent?.trim() || "",
      });
    });
    return out;
  };

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:999999;left:12px;right:12px;bottom:12px;padding:14px 16px;border-radius:12px;background:#121212;color:#fff;font:15px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.4)";
  box.textContent = "Crate: lese Angebote …";
  document.body.appendChild(box);

  (async () => {
    const params = new URLSearchParams(location.pathname.includes("/sell/mywants") ? location.search : "");
    params.set("limit", "250");
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= 40; page++) {
      params.set("page", String(page));
      const res = await fetch("/sell/mywants?" + params.toString(), { credentials: "include" });
      if (!res.ok) {
        box.textContent = "Crate: Fehler " + res.status + ". Bist du bei Discogs eingeloggt?";
        return;
      }
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const rows = parse(doc);
      all.push(...rows);
      box.textContent = "Crate: " + all.length + " Angebote gelesen (Seite " + page + ") …";
      if (rows.length < 200) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!all.length) {
      box.textContent = "Crate: Keine Angebote gefunden. Öffne discogs.com/sell/mywants und starte das Lesezeichen dort.";
      return;
    }
    const payload = { type: "crate-listings", listings: all, source: location.href };
    const win = window.open(appUrl + "/shop?import=1", "_blank");
    const onMsg = (e: MessageEvent) => {
      if (e.origin === appUrl && e.data === "crate-ready" && win) {
        win.postMessage(payload, appUrl);
        box.textContent = "Crate: " + all.length + " Angebote übertragen";
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
    if (!win) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
        box.textContent = "Crate: Pop-up blockiert. " + all.length + " Angebote in die Zwischenablage kopiert, in der App unter Shop einfügen.";
      } catch {
        box.textContent = "Crate: Pop-up blockiert. Bitte Pop-ups für discogs.com erlauben.";
      }
    }
  })();
}

// Browser dekodieren javascript:-URLs prozentweise, daher den Code komplett kodieren
export const bookmarkletCode = (appUrl: string) =>
  `javascript:${encodeURIComponent(`(${crateCollector.toString()})(${JSON.stringify(appUrl)});void 0`)}`;
