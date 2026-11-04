// Freunde suchen: Vorschläge beim Tippen, Auffindbar-Schalter
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
    await page.goto("http://localhost:8787/friends");
    await page.waitForTimeout(800);
    const toggle = await page.isVisible("text=Für Freunde auffindbar sein");
    await page.fill("input[placeholder*='Discogs-Name']", "max");
    await page.waitForSelector(".people-hit", { timeout: 8000 });
    await page.waitForTimeout(1500);
    const names = await page.locator(".people-hit b").allTextContents();
    await page.screenshot({ path: `${__dirname}/people-${scheme}.png` });
    await page.locator(".people-hit").first().click();
    await page.waitForTimeout(1500);
    const toast = await page.locator(".toast").first().textContent().catch(() => "-");
    console.log(scheme, "| Schalter", toggle, "| Vorschläge", names, "| nach Tipp:", toast, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
