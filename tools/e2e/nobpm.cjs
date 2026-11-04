// Beschriften: Hinweis auf Platten ohne Tempo, aufklappen, Liste antippbar
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
    await page.waitForTimeout(40000);
    await page.goto("http://localhost:8787/stickers");
    await page.waitForSelector(".nobpm", { timeout: 15000 });
    const head = await page.locator(".nobpm summary").textContent();
    await page.locator(".nobpm summary").click();
    await page.waitForTimeout(500);
    const rows = await page.locator(".nobpm-row").count();
    await page.locator(".nobpm").scrollIntoViewIfNeeded();
    await page.locator(".nobpm").screenshot({ path: `${__dirname}/nobpm-${scheme}.png` });
    await page.locator(".nobpm-row").first().click();
    await page.waitForTimeout(1200);
    console.log(scheme, "|", head, "| Zeilen", rows, "| nach Tipp:", page.url().replace("http://localhost:8787", ""), "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
