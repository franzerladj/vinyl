// Ziehen zum Aktualisieren auf Start und in der Sammlung
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
  await page.goto("http://localhost:8787/collection");
  await page.waitForSelector(".pager-pane.on .rec");
  await page.waitForTimeout(4000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 250 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: 250 + i * 25 }] });
    await page.waitForTimeout(16);
  }
  const mid = await page.evaluate(() => ({ main: document.querySelector(".main").style.transform, ptr: getComputedStyle(document.querySelector(".ptr")).opacity }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
  const busy = await page.evaluate(() => document.querySelector(".ptr").classList.contains("spin") || document.querySelectorAll(".job-pill").length > 0);
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => document.querySelector(".main").style.transform);
  console.log({ mid, busy, after, errors });
  await b.close();
})();
