// „Was könnte weg?“ im Wert-Blatt der Sammlung: wertvolle Platten, die in keinem Set stehen
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const out = {};
  const errors = [];
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten");
    await page.waitForTimeout(7000);
    // Testdaten: Platten stehen seit 2024 in der Sammlung, sechs haben einen Marktwert, eine steht in einem Set
    await page.evaluate(() => new Promise((res) => {
      const q = indexedDB.open("crate");
      q.onsuccess = () => {
        const tx = q.result.transaction(["collection", "marketStats", "sets", "tracks"], "readwrite");
        const coll = tx.objectStore("collection");
        coll.getAll().onsuccess = (e) => { for (const c of e.target.result) coll.put({ ...c, dateAdded: "2024-02-01T10:00:00-07:00", rating: c.releaseId === 4 ? 5 : 0 }); };
        const ms = tx.objectStore("marketStats");
        [[1, 120], [2, 80], [3, 60], [4, 300], [5, 45], [6, 8]].forEach(([id, v]) => ms.put({ releaseId: id, lowest: v, currency: "EUR", numForSale: 3, fetchedAt: Date.now() }));
        const tr = tx.objectStore("tracks");
        tr.getAll().onsuccess = (e) => {
          const t = e.target.result.find((x) => x.releaseId === 2);
          tx.objectStore("sets").put({ name: "Freitag", curve: "journey", trackIds: t ? [t.id] : [], crateIds: t ? [] : [2], createdAt: Date.now(), mixNotes: {} });
        };
        tx.oncomplete = res;
      };
    }));
    await page.goto(B + "/collection");
    await page.waitForSelector(".pager-pane.on .rec");
    await page.evaluate(() => document.querySelectorAll(".toast, .jobs").forEach((e) => (e.style.display = "none")));
    await page.click(".more-btn, button[aria-label='Mehr']").catch(() => {});
    await page.click("text=Wert der Sammlung");
    await page.waitForSelector("text=Was könnte weg?", { timeout: 15000 });
    const card = page.locator(".card:has-text('Was könnte weg?')");
    out[scheme] = { text: (await card.locator(".sub").first().innerText()).slice(0, 120), zeilen: await card.locator(".rec-title").allInnerTexts(), werte: await card.locator("b.mono").allInnerTexts(), meta: await card.locator(".rec-meta").first().innerText() };
    if (process.argv[2]) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.argv[2]}/sellable-${scheme}.png` }); }
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1), errors);
  await b.close();
})();
