// App wieder öffnen: was wird dabei erneut geladen?
// Erster Start bis alles fertig ist, dann die App zweimal ganz schließen und neu öffnen (derselbe Speicher)
// und je 25 s mitzählen, welche Anfragen rausgehen.
// Soll: nach dem ersten Mal fast nichts mehr (keine Tempo-Suche, keine Hörproben, keine Tracklists, keine Preise).
const { chromium, devices } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
const kind = (u) => {
  const p = new URL(u).pathname.replace(/^\/api\/discogs/, "discogs:");
  return p.replace(/\/\d+/g, "/#").replace(/\/users\/[^/]+/, "/users/me");
};
const HEAVY = /audio|lastfm|discogs:\/(releases|marketplace|masters|database)/;
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crate-reopen-"));
  const errors = [];
  /** App öffnen, zählen, wieder schließen */
  const session = async (watch, laterMs = 0) => {
    const ctx = await chromium.launchPersistentContext(dir, { ...devices["iPhone 13"] });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    // „Stunden später“: die Uhr der Seite vorstellen
    if (laterMs)
      await page.addInitScript((off) => {
        const Real = Date;
        class Later extends Real {
          constructor(...a) {
            if (a.length) super(...a);
            else super(Real.now() + off);
          }
          static now() {
            return Real.now() + off;
          }
        }
        window.Date = Later;
      }, laterMs);
    const counts = {};
    page.on("request", (r) => {
      const u = r.url();
      if (!u.includes("/api/")) return;
      const k = kind(u);
      counts[k] = (counts[k] ?? 0) + 1;
    });
    await page.goto(B + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=45 Platten", { timeout: 60000 });
    const res = await watch(page, counts);
    // Schließen kann im Testbrowser hängen (offene Anfragen): notfalls hart beenden
    await Promise.race([ctx.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
    return res;
  };
  const sum = (c) => Object.values(c).reduce((a, x) => a + x, 0);
  const out = {};
  out.ersterStart = await session(async (page, counts) => {
    // fertig, wenn 6 s lang keine Abgleich-Anzeige mehr zu sehen ist
    const t0 = Date.now();
    let calm = 0;
    while (Date.now() - t0 < Number(process.env.FIRST_MS || 300000) && calm < 6) {
      await page.waitForTimeout(1000);
      calm = (await page.locator(".job-pill").count()) ? 0 : calm + 1;
    }
    return { sekunden: Math.round((Date.now() - t0) / 1000), anfragen: sum(counts) };
  });
  console.error("erster Start", JSON.stringify(out.ersterStart));
  for (const n of [2, 3]) {
    out[`start${n}`] = await session(async (page, counts) => {
      const pills = new Set();
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(1000);
        const t = await page.locator(".job-pill").first().textContent({ timeout: 300 }).catch(() => null);
        if (t) pills.add(t.replace(/\d+ von \d+.*/, "").replace(/\d+/g, "#").trim());
      }
      const schwer = Object.fromEntries(Object.entries(counts).filter(([k]) => HEAVY.test(k)));
      return { anfragen: sum(counts), schwer, schwerSumme: sum(schwer), anzeige: [...pills], alle: counts };
    });
    console.error(`Start ${n}`, out[`start${n}`].anfragen, "Anfragen, davon schwer", out[`start${n}`].schwerSumme);
  }
  // Sieben Stunden später: Listen werden abgeglichen (wenige Anfragen), aber nichts je Track oder je Want neu geladen
  out.siebenStundenSpaeter = await session(async (page, counts) => {
    const pills = new Set();
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const t = await page.locator(".job-pill").first().textContent({ timeout: 300 }).catch(() => null);
      if (t) pills.add(t.replace(/\d+ von \d+.*/, "").replace(/\d+/g, "#").trim());
    }
    const schwer = Object.fromEntries(Object.entries(counts).filter(([k]) => HEAVY.test(k)));
    return { anfragen: sum(counts), schwer, schwerSumme: sum(schwer), anzeige: [...pills], alle: counts };
  }, 7 * 3600_000);
  console.log(JSON.stringify(out, null, 1), errors);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})();
