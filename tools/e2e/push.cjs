// Mitteilungen: Einstellungsseite (Browser und „iPhone im Safari“), Freund hinzufügen mit Rückmeldung
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const [scheme, ua] of [["light", null], ["dark", "iphone"]]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, ...(ua ? {} : { userAgent: devices["Pixel 7"].userAgent }) });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.goto("http://localhost:8787/settings");
    const row = await page.waitForSelector(".set-row:has-text(\"Mitteilungen\")", { timeout: 8000 }).then(() => true, () => false);
    await page.goto("http://localhost:8787/settings/notifications");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${__dirname}/push-${scheme}.png` });
    const text = (await page.textContent(".page")).slice(0, 120);
    await page.goto("http://localhost:8787/friends");
    await page.fill("input[placeholder*='Discogs-Name']", "kumpel");
    await page.keyboard.press("Enter");
    await page.waitForSelector("text=/hinzugefügt/", { timeout: 15000 }).catch(() => {});
    const toast = await page.locator(".toast").first().textContent().catch(() => "-");
    console.log(scheme, ua ?? "android", "row", row, "| page:", text, "| toast:", toast, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
