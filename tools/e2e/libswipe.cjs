// Sammlung <-> Wantlist per Wischen
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.goto(B + "/collection");
  await page.waitForSelector(".rec");
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x0, x1, y = 500) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(900);
  };
  await swipe(320, 120);
  const nachLinks = new URL(page.url()).pathname;
  await swipe(100, 320);
  const nachRechts = new URL(page.url()).pathname;
  await swipe(320, 300); // zu kurz: bleibt
  console.log({ nachLinks, nachRechts, kurz: new URL(page.url()).pathname, errors });
  await b.close();
})();
