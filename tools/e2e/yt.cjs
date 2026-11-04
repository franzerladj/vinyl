// YouTube-Einwilligung: Abfrage nach Login, danach Videos direkt, Frage nur einmal
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
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=Videos gleich laden?", { timeout: 10000 });
    await page.screenshot({ path: `${__dirname}/yt-sheet-${scheme}.png` });
    await page.click("text=Ja, direkt laden");
    await page.goto("http://localhost:8787/release/5");
    await page.waitForTimeout(2500);
    const iframes = await page.locator("iframe.video").count();
    const facades = await page.locator(".video-facade").count();
    await page.goto("http://localhost:8787/");
    await page.waitForTimeout(2500);
    console.log(scheme, "iframes", iframes, "facades", facades, "asked again", await page.isVisible("text=Videos gleich laden?"), "errors", errors);
    await ctx.close();
  }
  await b.close();
})();
