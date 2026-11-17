// Jahresrückblick als Story: öffnet beim ersten Besuch, tippen blättert, letzte Seite teilt
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const OUT = process.env.OUT || __dirname;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.waitForTimeout(1500);
  await page.goto("http://localhost:8787/year/2026?story=1");
  await page.waitForSelector(".ys", { timeout: 15000 });
  const seen = [];
  for (let n = 0; n < 10; n++) {
    await page.waitForTimeout(1400);
    const key = await page.evaluate(() => document.querySelector(".ys").className);
    seen.push(key.replace("ys ys-", ""));
    await page.screenshot({ path: `${OUT}/ys-${n}.png` });
    if (await page.locator(".ys-btn").count()) break;
    await page.mouse.click(340, 400);
  }
  // Die Karte ist vorbereitet: ein Tipp teilt sofort (im Test ohne Teilen-Menü: Bild wird gespeichert)
  await page.waitForTimeout(2500);
  const dl = page.waitForEvent("download", { timeout: 15000 }).then((d) => d.suggestedFilename(), () => null);
  await page.click(".ys-btn:has-text('In die Story teilen')");
  const file = await dl;
  const sheet = await page.locator(".sheet img").count();
  console.log({ seen, file, sheet, errors });
  await b.close();
})();
