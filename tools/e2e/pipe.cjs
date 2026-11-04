const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" }); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  const t0 = Date.now();
  await page.goto("http://localhost:8787/");
  const snap = async () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("crate"); r.onsuccess = () => { const db = r.result; const tx = db.transaction(["releases", "tracks", "marketStats"]); const out = {}; let n = 0; for (const s of ["releases", "tracks", "marketStats"]) { const q = tx.objectStore(s).getAll(); q.onsuccess = () => { const v = q.result; out[s] = s === "releases" ? v.filter((x) => x.detailFetchedAt).length : s === "tracks" ? [v.length, v.filter((x) => x.lookedUpAt).length, v.filter((x) => x.energy != null).length] : v.length; if (++n === 3) res(out); }; } }; r.onerror = () => res({}); }));
  for (let i = 0; i < 26; i++) { await page.waitForTimeout(5000); console.log(Math.round((Date.now() - t0) / 1000) + "s", JSON.stringify(await snap()), (await page.$(".progress-card")) ? "läuft" : "fertig"); if (!(await page.$(".progress-card")) && i > 2) break; }
  await page.goto("http://localhost:8787/settings/sync"); await page.waitForTimeout(1200);
  await page.screenshot({ path: __dirname + "/sync-status.png", fullPage: true });
  console.log("errors", errors); await b.close();
})();
