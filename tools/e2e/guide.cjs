// „Gut zu wissen“: Einstieg auf Start, Übersicht, Suche, eine Karte mit Quellen, Hinweis bei den Nadel-Stunden.
// Bilder nach tools/e2e/guide-*.png (hell und dunkel).
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, deviceScaleFactor: scheme === "light" ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten");
    // Einstieg auf Start unter „Werkzeug“
    await page.evaluate(() => document.querySelector(".guide-entry").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${__dirname}/guide-start-${scheme}.png` });
    await page.click(".guide-entry");
    await page.waitForSelector(".guide-area");
    const areas = await page.locator(".guide-area h2").allTextContents();
    const cards = await page.locator(".guide-row").count();
    // Der Schiebe-Übergang muss durch sein, sonst ist die halbe alte Seite mit im Bild
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${__dirname}/guide-index-${scheme}.png` });
    await page.evaluate(() => window.scrollTo(0, 620));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${__dirname}/guide-index2-${scheme}.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    // Suche über den Inhalt
    await page.fill(".guide-search", "antiskating");
    await page.waitForTimeout(250);
    const hits = await page.locator(".guide-row b").allTextContents();
    await page.fill(".guide-search", "");
    // Eine Karte öffnen
    await page.click(".guide-row:has-text('Die Nadel reinigen')");
    await page.waitForSelector(".guide-lead");
    const karte = {
      titel: await page.locator(".page-head h1").textContent(),
      tun: await page.locator(".guide-list").first().locator("li").count(),
      lassen: await page.locator(".guide-list").nth(1).locator("li").count(),
      quellen: await page.locator(".guide-sources a").evaluateAll((as) => as.map((a) => new URL(a.href).hostname + (a.target === "_blank" ? "" : " (kein neues Fenster)"))),
      inCrate: await page.locator(".guide .group-row").first().textContent(),
      weiter: (await page.locator(".guide-next").textContent()).trim(),
    };
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${__dirname}/guide-karte-${scheme}.png` });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${__dirname}/guide-karte2-${scheme}.png` });
    // Weiter zur nächsten Karte: beginnt oben
    await page.click(".guide-next");
    await page.waitForFunction((t) => document.querySelector(".page-head h1")?.textContent !== t, karte.titel);
    const naechste = { titel: await page.locator(".page-head h1").textContent(), oben: await page.evaluate(() => window.scrollY) };
    // Karte aus der Praxis sagt das offen
    await page.goto(B + "/guide/tasche");
    await page.waitForSelector(".guide-sources");
    const praxis = (await page.locator(".guide-sources").textContent()).slice(0, 60);
    // Unbekannte Karte
    await page.goto(B + "/guide/gibt-es-nicht");
    await page.waitForSelector(".btn:has-text('Zur Übersicht')");
    const unbekannt = await page.locator("text=Diese Karte gibt es nicht").count();
    // Hinweis bei den Nadel-Stunden führt zur Karte
    await page.goto(B + "/settings/stylus");
    await page.waitForSelector(".guide-tip");
    const tipps = await page.locator(".guide-tip b").allTextContents();
    await page.locator(".guide-tip").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${__dirname}/guide-nadel-${scheme}.png` });
    await page.click(".guide-tip >> nth=0");
    await page.waitForSelector(".guide-lead");
    out[scheme] = { areas, cards, hits, karte, naechste, praxis, unbekannt, tipps, nachTipp: new URL(page.url()).pathname, errors };
    await ctx.close();
  }
  console.log(JSON.stringify(out.light, null, 1));
  console.log("dunkel gleich:", JSON.stringify({ ...out.dark, errors: [] }) === JSON.stringify({ ...out.light, errors: [] }), out.dark.errors);
  await b.close();
})();
