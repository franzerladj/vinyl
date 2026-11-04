// Platte des Moments: verzeihende Suche (Klammern, Satzzeichen, &), Wantlist und Discogs als Ergänzung
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.waitForTimeout(3000);
  await page.goto("http://localhost:8787/settings/profile");
  await page.waitForSelector("text=So sehen dich Freunde");
  for (const q of ["Can [You] Feel-It!", "mr fingers can you", "feel it fingers"]) {
    await page.fill("input[placeholder*='Platte']", q);
    await page.waitForTimeout(1500);
    const rows = await page.locator(".pick-row .label").allTextContents();
    console.log(JSON.stringify(q), "→", rows.slice(0, 3).map((x) => x.slice(0, 50)));
  }
  await page.locator(".pick-row").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${__dirname}/pick-dark.png` });
  // Sammlung: dieselbe Suche
  await page.goto("http://localhost:8787/collection");
  await page.waitForTimeout(1500);
  await page.fill("input[placeholder*='Artist']", "Can [You] Feel-It!");
  await page.waitForTimeout(800);
  console.log("Sammlung:", (await page.locator(".rec-title").allTextContents()).slice(0, 3), "| errors", errors);
  await b.close();
})();
