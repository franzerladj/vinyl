// Flüssigkeit messen: Bildzeiten bei typischen Bewegungen, CPU 4x gedrosselt (mittleres Handy).
// Ausgabe je Ablauf: Bilder, davon zu spät (> 25 ms), längstes Bild. Vorher/Nachher vergleichen.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: process.env.SCHEME || "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.addInitScript(() => {
    localStorage.setItem("crate:yt", "no");
    window.__f = [];
    let last = 0;
    const loop = (t) => { if (last) window.__f.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(9000); // erster Sync durch
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const res = {};
  const run = async (name, fn) => {
    await page.waitForTimeout(400);
    await page.evaluate(() => (window.__f = []));
    await fn();
    const f = await page.evaluate(() => window.__f.slice());
    const late = f.filter((d) => d > 25).length;
    res[name] = `${f.length} Bilder, ${late} zu spät (${Math.round((100 * late) / Math.max(1, f.length))} %), längstes ${Math.round(Math.max(0, ...f))} ms`;
  };
  const touch = async (pts) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pts[0]] });
    for (const p of pts.slice(1)) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await run("Start scrollen", async () => { for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(16); } await page.waitForTimeout(500); });
  await run("Tab Platten", async () => { await page.click(".nav >> text=Platten"); await page.waitForSelector(".rec"); await page.waitForTimeout(900); });
  await run("Sammlung scrollen", async () => { for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); } await page.waitForTimeout(500); });
  await run("Platte öffnen", async () => { await page.locator(".rec").nth(3).click(); await page.waitForSelector(".tracks"); await page.waitForTimeout(1000); });
  await run("Zurück", async () => { await page.goBack(); await page.waitForSelector(".rec"); await page.waitForTimeout(900); });
  await run("Filter-Blatt", async () => { await page.click("button:has-text('Filter')"); await page.waitForTimeout(700); await page.keyboard.press("Escape"); await page.waitForTimeout(700); });
  await run("Wischen zur Wantlist", async () => { const pts = []; for (let i = 0; i <= 8; i++) pts.push({ x: 320 - i * 28, y: 330 }); await touch(pts); await page.waitForTimeout(900); });
  await run("Tab Sets", async () => { await page.click(".nav >> text=Sets"); await page.waitForTimeout(900); });
  await run("Tab Start", async () => { await page.click(".nav >> text=Start"); await page.waitForTimeout(900); });
  await run("Diggen öffnen", async () => { await page.click(".nav >> text=Diggen"); await page.waitForSelector(".dig-card"); await page.waitForTimeout(1200); });
  await run("Diggen wischen", async () => { for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(500); } });
  console.log(JSON.stringify(res, null, 1), errors.slice(0, 3));
  await b.close();
})();
