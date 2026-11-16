// Freundschaftsanfrage: Hinweis auf Start, Annehmen auf der Freunde-Seite, eigene Anfrage beim Hinzufügen
// FRIENDS=1 node tools/e2e/friendreq.cjs [ordner für Bilder]
process.env.FRIENDS = "1";
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
const out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const page = await (await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    await page.waitForSelector(".friend-nudge", { timeout: 15000 });
    const nudge = (await page.locator(".friend-nudge b").innerText()).trim();
    if (out) await page.screenshot({ path: `${out}/freq-start-${scheme}.png` });
    await page.click(".friend-nudge");
    await page.waitForSelector(".friend-req");
    if (out) await page.screenshot({ path: `${out}/freq-seite-${scheme}.png` });
    await page.click(".friend-req button:has-text('Annehmen')");
    await page.waitForSelector(".toast:has-text('befreundet')", { timeout: 15000 });
    await page.waitForTimeout(600);
    const offen = await page.locator(".friend-req").count();
    const inListe = await page.locator(".rec-title:has-text('Max Kumpel')").count();
    // Selbst jemanden hinzufügen: Anfrage geht raus, Zeile zeigt „Anfrage offen“
    await page.fill("input[placeholder*='Discogs-Name']", "deepdigger");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".toast:has-text('Anfrage an')", { timeout: 15000 });
    await page.waitForSelector(".badge:has-text('Anfrage offen')", { timeout: 8000 });
    await page.goto(B + "/");
    await page.waitForTimeout(1200);
    console.log(scheme, { nudge, offen, inListe, hinweisWeg: (await page.locator(".friend-nudge").count()) === 0, errors });
  }
  await b.close();
})();
