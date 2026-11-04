// Kopf der Startseite zu verschiedenen Uhrzeiten, hell und dunkel, 320 und 390 px
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const runs = [["dark", 390, "2026-11-05T23:41:00"], ["light", 390, "2026-11-05T19:10:00"], ["dark", 320, "2026-11-05T08:15:00"]];
  for (const [scheme, w, time] of runs) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], viewport: { width: w, height: 844 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(time));
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${__dirname}/hero-${scheme}-${w}-${time.slice(11, 13)}.png`, clip: { x: 0, y: 0, width: w, height: 430 } });
    console.log(scheme, w, time.slice(11, 16), "|", await page.locator(".home-hero h1").textContent(), "|", await page.locator(".home-hero-status").textContent(), "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
