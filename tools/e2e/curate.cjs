// Set kuratieren: Kiste packen, Vorschläge wählen, Notiz, Umsortieren, Live-Modus
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.waitForTimeout(scheme === "dark" ? 40000 : 3000);
    await page.goto("http://localhost:8787/sets/new");
    await page.click("text=Kiste packen");
    await page.waitForSelector(".pick-rec");
    for (let i = 0; i < 8; i++) await page.locator(".pick-rec").nth(i).click();
    await page.screenshot({ path: `${__dirname}/curate-pick-${scheme}.png` });
    await page.click("text=/Fertig \\(8\\)/");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${__dirname}/curate-crate-${scheme}.png` });
    await page.click(".seg >> text=/Reihenfolge/");
    for (let i = 0; i < 5; i++) {
      await page.locator(".next-panel .next-add").first().click();
      await page.waitForTimeout(250);
    }
    const n = await page.locator(".order-item").count();
    const reasons = await page.locator(".next-panel .next-reasons").first().textContent().catch(() => "-");
    // Notiz am zweiten Übergang
    await page.locator("button.transition").first().click();
    await page.fill("textarea", "im Breakdown rein");
    await page.click("text=Notiz speichern");
    await page.waitForTimeout(400);
    // Ziehen: Track 1 ans Ende
    const before = await page.locator(".order-item .rec-title").allTextContents();
    const h = await page.locator(".order-handle").first().boundingBox();
    const last = await page.locator(".order-item").last().boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 10, last.y + last.height - 5, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await page.locator(".order-item .rec-title").allTextContents();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${__dirname}/curate-order-${scheme}.png`, fullPage: true });
    await page.click("text=Live-Modus");
    await page.waitForSelector(".live");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${__dirname}/curate-live-${scheme}.png` });
    await page.click("text=Gespielt, weiter");
    const pos = await page.locator(".live-top .sub").textContent();
    console.log(scheme, "| Tracks", n, "| erster Vorschlag:", reasons, "| gezogen:", before[0] === after[after.length - 1], "| live:", pos, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
