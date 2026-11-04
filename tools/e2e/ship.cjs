// Versand-Schätzung im Shop und Überschrift auf der Startseite
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
    const heading = await page.isVisible("text=Zuletzt hinzugefügt");
    await page.goto("http://localhost:8787/shop");
    await page.click("text=Versand & Regeln");
    await page.waitForTimeout(500);
    const box = page.locator("details.card").first();
    await box.screenshot({ path: `${__dirname}/ship-${scheme}.png` });
    const inp = page.locator(".ship-row").first().locator("input").first();
    await inp.fill("6,5");
    await page.waitForTimeout(300);
    console.log(scheme, "heading", heading, "example", await page.locator(".ship-example").textContent(), "errors", errors);
    await ctx.close();
  }
  await b.close();
})();
