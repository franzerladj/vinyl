// YouTube-Einwilligung: erst beim ersten angetippten Video gefragt, danach Videos direkt, Frage nur einmal
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
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const askedAtStart = await page.isVisible("text=Videos künftig gleich laden?");
    await page.goto("http://localhost:8787/release/5");
    await page.waitForSelector(".video-facade", { timeout: 20000 });
    const before = await page.locator(".video-facade").count();
    await page.locator(".video-facade").first().click();
    await page.waitForSelector("text=Videos künftig gleich laden?", { timeout: 10000 });
    await page.screenshot({ path: `${__dirname}/yt-hint-${scheme}.png` });
    await page.click(".hint button:has-text('Ja')");
    await page.reload();
    await page.waitForTimeout(2500);
    const iframes = await page.locator("iframe.video").count();
    const facades = await page.locator(".video-facade").count();
    const askedAgain = await page.isVisible("text=Videos künftig gleich laden?");
    console.log(scheme, { askedAtStart, facadesVorher: before, iframesNachher: iframes, facadesNachher: facades, askedAgain, errors });
    await ctx.close();
  }
  await b.close();
})();
