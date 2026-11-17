// Sammlung <-> Wantlist und Sets <-> Nächster Track: Pager wie in nativen Apps.
// Kopf und Umschalter bleiben stehen, der Schieber folgt dem Finger, nur der Inhalt gleitet,
// die Nachbarseite ist beim Wischen schon sichtbar.
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
  await page.waitForSelector(".pager-pane.on .rec");
  // Nachbarseite wird im Leerlauf vorbereitet
  await page.waitForFunction(() => document.querySelectorAll(".pager-pane").length === 2 && document.querySelector(".pager-pane.off .rec"), null, { timeout: 8000 });
  const cdp = await ctx.newCDPSession(page);
  const probe = () =>
    page.evaluate(() => {
      const panes = [...document.querySelectorAll(".pager-pane")];
      const sw = document.querySelector(".lib-switch, .page-switch");
      return {
        switchY: Math.round(sw.getBoundingClientRect().top),
        switchT: getComputedStyle(sw).transform,
        thumb: document.querySelector(".seg-thumb").style.transform,
        panes: panes.map((p) => ({ cls: p.className, x: Math.round(p.getBoundingClientRect().left), vis: getComputedStyle(p).visibility })),
      };
    });
  const swipe = async (x0, x1, y = 330, stop) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    let mid;
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y }] });
      await page.waitForTimeout(16);
      if (i === 5) mid = await probe();
    }
    if (stop) await page.waitForTimeout(200);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(1000);
    return mid;
  };
  const before = await probe();
  const mid1 = await swipe(330, 90);
  const nachLinks = new URL(page.url()).pathname;
  const after1 = await probe();
  const mid2 = await swipe(90, 330);
  const nachRechts = new URL(page.url()).pathname;
  await swipe(320, 290, 330, true); // zu kurz und langsam: bleibt
  const kurz = new URL(page.url()).pathname;
  // Tippen auf den Umschalter gleitet ebenfalls
  await page.click(".lib-switch .seg button:nth-child(3)");
  await page.waitForTimeout(80);
  const tapMid = await probe();
  await page.waitForTimeout(600);
  const nachTipp = new URL(page.url()).pathname;
  // Tief gescrollt wischen: neue Liste beginnt oben am Bildschirm, kein Sprung danach
  await page.click(".lib-switch .seg button:nth-child(2)");
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(300);
  await swipe(330, 90);
  const deep = await page.evaluate(() => ({ y: Math.round(scrollY), path: location.pathname, firstRow: Math.round(document.querySelector(".pager-pane.on .toolbar").getBoundingClientRect().top) }));
  const oneActiveInput = await page.evaluate(() => document.querySelectorAll(".pager-pane.on .search-bar input").length);
  const fab = await page.evaluate(() => {
    const f = document.querySelector(".fab");
    return f ? getComputedStyle(f.parentElement).visibility : "none";
  });
  // Sets <-> Nächster Track
  await page.goto(B + "/sets");
  await page.waitForSelector(".page-switch .seg");
  await page.waitForFunction(() => document.querySelectorAll(".pager-pane").length === 2, null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const setsMid = await swipe(330, 90, 330);
  const setsTab = await page.evaluate(() => document.querySelector(".page-switch [aria-selected=true]").textContent);
  await swipe(90, 330, 450);
  const setsBack = await page.evaluate(() => document.querySelector(".page-switch [aria-selected=true]").textContent);
  console.log(JSON.stringify({ before, mid1, after1, mid2, nachLinks, nachRechts, kurz, tapMid, nachTipp, deep, oneActiveInput, fab, setsMid, setsTab, setsBack, errors }, null, 1));
  await b.close();
})();
