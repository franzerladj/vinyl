// Preise laden darf nicht hängen bleiben, wenn eine Discogs-Anfrage nie antwortet
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await install(page);
  await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
  let hung = 0;
  // Eine Preis-Anfrage antwortet nie (wie ein Funkloch); die anderen normal
  await page.route((u) => u.pathname === "/api/discogs/marketplace/stats/47", () => { hung++; /* nie beantworten */ });
  const t0 = Date.now();
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  // Warten, bis alle Preise der Wantlist da sind (außer der hängenden)
  const count = () => page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("marketStats").objectStore("marketStats").getAllKeys(); g.onsuccess = () => { const k = new Set(g.result); let n = 0; for (let i = 46; i <= 70; i++) if (i !== 47 && k.has(i)) n++; r(n); }; }; }));
  let n = 0;
  while (Date.now() - t0 < 300000 && (n = await count()) < 24) await page.waitForTimeout(3000);
  const done = n >= 24;
  console.log({ alleAnderenPreise: done, sekunden: Math.round((Date.now() - t0) / 1000), haengendeAnfragen: hung });
  await b.close();
})();
