// Shop: zwischen Warenkorb, Budget und Händler wischen (Pager mit drei Seiten)
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
  await page.goto("http://localhost:8787/shop");
  await page.waitForSelector(".page-switch .seg");
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  const sel = () => page.evaluate(() => document.querySelector(".page-switch [aria-selected=true]").textContent);
  const swipe = async (x0, x1, y = 225) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(900);
  };
  const seq = [await sel()];
  await swipe(330, 90); seq.push(await sel());
  await swipe(330, 90); seq.push(await sel());
  await swipe(330, 90); seq.push(await sel()); // am Ende: Gummiband, bleibt
  await swipe(90, 330); seq.push(await sel());
  await page.click(".page-switch .seg button:nth-child(2)"); await page.waitForTimeout(700); seq.push(await sel());
  console.log(seq, errors);
  await b.close();
})();
