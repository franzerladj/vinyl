// Seitlich zwischen den Hauptbereichen wischen: Start | Sammlung | Wantlist | Meine Sets | Nächster Track | Freunde
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
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const where = () => page.evaluate(() => location.pathname + (document.querySelector(".pager-wrap .seg [aria-selected=true]") ? " · " + document.querySelector(".pager-wrap .seg [aria-selected=true]").textContent : "") + " · Tab " + (document.querySelector(".nav a.active")?.textContent ?? "-"));
  const swipe = async (x0, x1, y = 460) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(1300);
  };
  const seq = [await where()];
  for (let i = 0; i < 6; i++) { await swipe(330, 80); seq.push(await where()); } // bis ganz nach rechts, der letzte bleibt
  const style = await page.evaluate(() => document.querySelector(".main").style.cssText);
  for (let i = 0; i < 3; i++) { await swipe(60, 320); seq.push(await where()); } // und wieder zurück
  console.log(seq.join("\n"), "\nstyle:", JSON.stringify(style), errors);
  await b.close();
})();
