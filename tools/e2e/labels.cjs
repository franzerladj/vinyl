// Label vervollständigen: Übersicht der eigenen Labels und Label-Seite mit fehlenden Platten
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
    await page.waitForTimeout(1500);
    await page.goto("http://localhost:8787/labels");
    await page.waitForSelector(".rec", { timeout: 15000 });
    const first = await page.locator(".rec .rec-title").first().textContent();
    await page.screenshot({ path: `${__dirname}/labels-index-${scheme}.png` });
    await page.locator(".rec").first().click();
    await page.waitForSelector("text=/Du hast \\d+ von \\d+/", { timeout: 20000 });
    const head = await page.locator("text=/Du hast \\d+ von \\d+/").textContent();
    await page.screenshot({ path: `${__dirname}/labels-page-${scheme}.png` });
    const missing = await page.locator(".rec").count();
    await page.locator(".rec button:has-text('Wantlist')").first().click().catch(() => {});
    await page.waitForTimeout(800);
    console.log(scheme, first, "|", head, "| fehlen:", missing, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
