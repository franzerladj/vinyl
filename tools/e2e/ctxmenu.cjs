// Langes Drücken auf eine Platte öffnet das Schnellmenü, ohne die Platte zu öffnen
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.goto("http://localhost:8787/collection");
  await page.waitForSelector(".pager-pane.on .rec");
  await page.waitForTimeout(1500);
  const box = await page.locator(".pager-pane.on .rec").nth(1).boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 120, y: box.y + 20 }] });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => ({ menu: [...document.querySelectorAll(".ctx-menu button")].map((b) => b.textContent), path: location.pathname }));
  await page.screenshot({ path: (process.env.OUT || __dirname) + "/ctxmenu.png" });
  await page.click(".ctx-menu button:has-text('Platte öffnen')");
  await page.waitForTimeout(800);
  console.log({ open, after: new URL(page.url()).pathname, errors });
  await b.close();
})();
