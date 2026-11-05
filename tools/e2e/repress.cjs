// Repress-Alarm: Hinweis auf der Wantlist und Abzeichen an der Platte
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    // Ergebnis einer Prüfung vorgeben (die Logik selbst testet tests/repress.test.ts)
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const t = q.result.transaction("kv", "readwrite"); t.objectStore("kv").put({ key: "repressNews", value: [{ wantId: 46, masterId: 2046, at: Date.now(), version: { id: 11046, title: "Repress", label: "Repress Records", catno: "RP2046", country: "Germany", released: "2026" } }] }); t.oncomplete = r; }; }));
    await page.goto("http://localhost:8787/wants");
    await page.waitForSelector(".repress-card", { timeout: 15000 });
    const text = await page.locator(".repress-card").innerText();
    await page.locator(".repress-card").screenshot({ path: `${__dirname}/repress-${scheme}.png` });
    const badge = await page.locator(".badge:has-text('Repress 2026')").count();
    await page.click(".repress-card button");
    await page.waitForTimeout(500);
    const gone = !(await page.isVisible(".repress-card"));
    console.log(scheme, JSON.stringify(text.split("\n").slice(0, 3)), "| Abzeichen:", badge, "| weg:", gone, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
