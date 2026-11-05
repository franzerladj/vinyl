// Feed: Filter (Jahrzehnt, Preis), Preis auf der Karte, Wischen nach links
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
  await page.goto("http://localhost:8787/dig");
  await page.waitForSelector(".dig-card .dig-title", { timeout: 30000 });
  await page.waitForTimeout(2000);
  const price = await page.locator(".dig-card").first().locator(".dig-price").textContent().catch(() => "-");
  // Filter: bis 40 €
  await page.click("button[aria-label=Filter]");
  await page.click(".dig-sheet >> text=bis 40 €");
  await page.screenshot({ path: __dirname + "/feed-filter.png" });
  await page.click("text=Anwenden");
  await page.waitForSelector(".dig-card .dig-title", { timeout: 30000 });
  await page.waitForTimeout(3000);
  const chip = await page.locator(".dig-chip.on").first().textContent();
  // Scrollen und Preise der sichtbaren Karten einsammeln
  const prices = [];
  for (let i = 0; i < 4; i++) {
    const t = await page.locator(".dig-card").nth(i).locator(".dig-price").textContent().catch(() => null);
    if (t) prices.push(t);
    await page.evaluate(() => document.querySelector(".dig-feed").scrollBy({ top: innerHeight }));
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => document.querySelector(".dig-feed").scrollTo({ top: 0 }));
  await page.waitForTimeout(800);
  // Wischen nach links per Touch
  const first = await page.locator(".dig-card").first().getAttribute("aria-label");
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", 300, 400);
  for (let x = 290; x >= 120; x -= 20) await touch("touchMove", x, 405);
  await page.screenshot({ path: __dirname + "/feed-swipe.png" });
  await touch("touchEnd");
  await page.waitForTimeout(700);
  const after = await page.locator(".dig-card").first().getAttribute("aria-label");
  console.log("Preis:", price, "| Filter-Chip:", chip, "| Preise:", prices, "| weggewischt:", first !== after, "| errors", errors);
  await b.close();
})();
