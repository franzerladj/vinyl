// Begrüßung beim ersten Start, Einmal-Hinweis auf der Platten-Seite, YouTube-Frage beim ersten Video
process.env.WELCOME = "1";
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
    await page.waitForSelector(".welcome", { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.locator(".sheet").screenshot({ path: `${__dirname}/welcome-1-${scheme}.png` });
    const titles = [];
    for (let i = 0; i < 4; i++) {
      titles.push(await page.locator(".welcome-title").textContent());
      await page.click(".welcome .btn.primary");
      await page.waitForTimeout(250);
      if (i === 1) await page.locator(".sheet").screenshot({ path: `${__dirname}/welcome-3-${scheme}.png` });
    }
    await page.waitForTimeout(500);
    const gone = !(await page.isVisible(".welcome"));
    await page.reload(); await page.waitForTimeout(1500);
    const again = await page.isVisible(".welcome");
    await page.goto("http://localhost:8787/release/2"); await page.waitForSelector("table tr", { timeout: 20000 });
    const hint = await page.isVisible("text=Tippe auf einen Track zum Reinhören");
    await page.locator(".hint").first().screenshot({ path: `${__dirname}/hint-${scheme}.png` });
    await page.click(".hint .hint-x");
    const hintGone = !(await page.isVisible("text=Tippe auf einen Track zum Reinhören"));
    console.log(scheme, titles, "| zu:", gone, "| wieder:", again, "| Hinweis:", hint, "weg:", hintGone, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
