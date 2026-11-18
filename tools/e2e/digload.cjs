// Diggen, während im Hintergrund der Abgleich läuft: jede Karte muss ihre Tracks zügig bekommen.
// Vorher verbrauchte der Abgleich das Minuten-Kontingent von Discogs in den ersten Sekunden, dann
// warteten Karten und Platten-Seiten bis zu 48 Sekunden.
// DWELL=250 node tools/e2e/digload.cjs 30 wischt schnell durch (Verweildauer je Karte in ms).
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  let warm = 0;
  await page.route("**/api/audio/preview**", (r) => {
    if (r.request().url().includes("warm=1")) return (warm++, r.fulfill({ status: 204, body: "" }));
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten");
  // Der Abgleich (Tracklists, Preise) läuft jetzt: sofort ins Diggen
  await page.goto(B + "/dig");
  await page.waitForSelector(".dig-sound", { timeout: 30000 });
  const waits = [];
  const N = Number(process.argv[2] || 22);
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    // Karte ist geladen, sobald die Zeile die Anzahl der Tracks nennt
    const ok = await page.waitForFunction((k) => { const cards = document.querySelectorAll(".dig-card"); const s = cards[k]?.querySelector(".dig-now span")?.textContent ?? ""; return /Track/.test(s); }, i, { timeout: 60000 }).then(() => true, () => false);
    waits.push(ok ? Date.now() - t0 : -1);
    await page.waitForTimeout(Number(process.env.DWELL || 1200));
    await page.evaluate(() => { const f = document.querySelector(".dig-feed"); f.scrollBy({ top: f.clientHeight }); });
    await page.waitForTimeout(350);
  }
  // Danach eine Platte öffnen: auch die muss sofort laden
  await page.goto(B + "/release/88");
  const t0 = Date.now();
  const rel = await page.waitForSelector("tr td.pos", { timeout: 60000 }).then(() => Date.now() - t0, () => -1);
  const good = waits.filter((w) => w >= 0);
  console.log(JSON.stringify({ karten: waits.length, haengend: waits.filter((w) => w < 0).length, laengsteMs: Math.max(...good), ueber3s: good.filter((w) => w > 3000).length, mittelMs: Math.round(good.reduce((a, c) => a + c, 0) / good.length), platteMs: rel, vorgewaermt: warm, jobs: await page.evaluate(() => document.querySelector(".job-pill")?.textContent ?? "kein Abgleich mehr") }), errors);
  await b.close();
})();
