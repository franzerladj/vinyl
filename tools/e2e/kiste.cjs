// „Die Kiste in Bildern“ auf /dj: Kurve mit Fadenkreuz, Kauf-Kalender, Erscheinungsjahre, Rangliste mit Sprung in die Sammlung
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const OUT = process.env.OUT || __dirname;
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten");
    await page.goto(B + "/dj");
    await page.waitForSelector(".kc-section", { timeout: 20000 });
    const out = { karten: await page.locator(".kc").count() };
    // Kurve: Finger aufsetzen und ziehen, Wert am Fadenkreuz und die große Zahl folgen
    const area = page.locator(".kc-area");
    await area.scrollIntoViewIfNeeded();
    const box = await area.boundingBox();
    out.heute = await page.locator(".kc-1 .djo-big b").innerText();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 4 });
    out.tip = await page.locator(".kc-area .kc-tip").innerText();
    out.imMonat = await page.locator(".kc-1 .djo-big b").innerText();
    await page.mouse.up();
    // Tastatur: Pfeiltaste geht einen Monat weiter
    await area.focus();
    await page.keyboard.press("Home");
    const erster = await page.locator(".kc-area .kc-tip").innerText();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    out.pfeil = `${erster.replace(/\n/g, " ")} -> ${(await page.locator(".kc-area .kc-tip").innerText()).replace(/\n/g, " ")}`;
    // Kalender: Monat antippen
    const cell = page.locator(".kc-cell:not(.future):not(.l0)").first();
    await cell.scrollIntoViewIfNeeded();
    out.kalenderVorher = await page.locator(".kc-read").innerText();
    await cell.click();
    out.kalender = await page.locator(".kc-read").innerText();
    // Jahre
    out.jahre = await page.locator(".kc-bars > i").count();
    out.vorn = await page.locator(".kc-3 .djo-big").innerText();
    await page.screenshot({ path: `${OUT}/kiste-${scheme}.png`, fullPage: true });
    // Rangliste: Labels führen in die Sammlung mit gefüllter Suche
    await page.locator(".kc .seg [role=tab]:has-text('Labels')").click();
    await page.waitForTimeout(300);
    const label = await page.locator(".kc-rank-row .kc-rank-name").first().innerText();
    await page.locator("a.kc-rank-row").first().click();
    await page.waitForURL("**/collection**");
    await page.waitForTimeout(800);
    out.suche = `${label} -> ${await page.locator(".pager-pane.on input[type=search]").first().inputValue()}`;
    out.treffer = await page.locator(".pager-pane.on .rec").count();
    console.log(scheme, JSON.stringify(out, null, 1));
    await ctx.close();
  }
  console.log("errors", errors);
  await b.close();
})();
