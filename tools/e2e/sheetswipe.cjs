// Blätter schließen mit einem Wisch nach unten, egal wo man sie anfasst
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  const cdp = await ctx.newCDPSession(page);
  const swipeDown = async (x, y, dist) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dist * i) / 8 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500);
  };
  const out = {};
  // Menü der Sammlung: mitten im Blatt nach unten wischen
  await page.goto("http://localhost:8787/collection");
  await page.waitForSelector(".pager-pane.on .rec");
  await page.waitForTimeout(800);
  await page.click("button[aria-label='Mehr']");
  await page.waitForSelector(".sheet .option");
  await page.waitForTimeout(600);
  let box = await page.locator(".sheet .option").nth(1).boundingBox();
  await swipeDown(box.x + 100, box.y + 10, 30); // zu kurz: bleibt
  out.kurzBleibt = (await page.locator(".sheet").count()) === 1;
  await swipeDown(box.x + 100, box.y + 10, 200);
  out.menuZu = (await page.locator(".sheet").count()) === 0;
  // Filter im Diggen
  await page.goto("http://localhost:8787/dig");
  await page.waitForSelector(".dig-card .dig-deck, .dig-card img", { timeout: 20000 });
  await page.click("button[aria-label='Filter']");
  await page.waitForSelector(".dig-sheet");
  await page.waitForTimeout(600);
  box = await page.locator(".dig-sheet .chips").first().boundingBox();
  await swipeDown(box.x + 150, box.y + 10, 220);
  out.digFilterZu = (await page.locator(".dig-sheet").count()) === 0;
  console.log(out, errors);
  await b.close();
})();
