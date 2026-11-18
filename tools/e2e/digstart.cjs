// Diggen öffnen: wie lange dauert es bis zur ersten Karte?
// Die Suche von Discogs ist hier absichtlich träge (SLOW ms je Anfrage, Standard 2500), eine Quelle hängt ganz,
// und im Hintergrund läuft der Abgleich. Geprüft wird:
//   1. erster Besuch gleich nach dem Start
//   2. Diggen verlassen und wieder öffnen (die übrigen Karten liegen noch bereit)
//   3. App neu laden und Diggen öffnen (gemerkte Kiste)
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
const SLOW = Number(process.env.SLOW || 2500);
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  let searches = 0;
  await page.route("**/database/search**", async (r) => {
    const n = ++searches;
    // Jede fünfte Suche hängt (Discogs antwortet nicht)
    if (n % 5 === 3) return;
    await new Promise((res) => setTimeout(res, SLOW));
    return r.fallback();
  });
  const open = async () => {
    const t0 = Date.now();
    await page.click('.nav a[href="/dig"]');
    const ok = await page.waitForSelector(".dig-sound", { timeout: 120000 }).then(() => true, () => false);
    return ok ? Date.now() - t0 : -1;
  };
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten");
  // Wer die App öffnet und gleich auf Diggen tippt, hat noch nichts vorgeladen
  const first = await open();
  const firstCount = await page.locator(".dig-sound").count();
  await page.waitForTimeout(SLOW + 1500);
  const later = await page.locator(".dig-sound").count();
  // Ein paar Karten ansehen, dann raus und wieder rein
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const f = document.querySelector(".dig-feed"); f.scrollBy({ top: f.clientHeight }); });
    await page.waitForTimeout(700);
  }
  const seenTitle = await page.evaluate(() => document.querySelector(".dig-card h2, .dig-card .dig-title")?.textContent ?? "");
  await page.click("text=Fertig");
  await page.waitForSelector(".nav a[href='/dig']");
  const again = await open();
  await page.click("text=Fertig");
  await page.waitForTimeout(500);
  // Neu laden: die gemerkte Kiste ist sofort da
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten");
  const reload = await open();
  console.log(JSON.stringify({ traegeSucheMs: SLOW, ersterBesuchMs: first, kartenSofort: firstCount, kartenSpaeter: later, wiederOeffnenMs: again, nachNeuladenMs: reload, suchen: searches, seenTitle }), errors);
  await b.close();
})();
