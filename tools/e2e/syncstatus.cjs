// Abgleich in Klartext: Anzeige unten nennt Schritt, Stand und Restzeit; Antippen öffnet das Blatt
// mit allen Schritten samt Grund; die Pause von Discogs wird erklärt.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const out = {};
  const errors = [];
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.click(".nav >> text=Platten");
    await page.waitForSelector(".job-pill");
    await page.waitForFunction(() => / von \d+/.test(document.querySelector(".job-pill")?.textContent ?? ""), null, { timeout: 20000 });
    out.pill = await page.textContent(".job-pill");
    await page.click(".job-pill");
    await page.waitForSelector(".sync-sheet .sync-job");
    out.titles = await page.$$eval(".sync-sheet .sync-job b", (els) => els.map((e) => e.textContent));
    out.meta = await page.$$eval(".sync-sheet .sync-meta", (els) => els.map((e) => [...e.children].map((c) => c.textContent).join(" | ")));
    out.why = await page.$$eval(".sync-sheet .sync-job .tiny", (els) => els.length);
    // Nach rund 50 Anfragen ist die Minute bei Discogs voll: das sagt die App dazu
    await page.waitForSelector(".sync-pause", { timeout: 40000 }).catch(() => undefined);
    out.pause = await page.textContent(".sync-pause").catch(() => null);
    out.lead = await page.textContent(".sync-lead");
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/sync-${scheme}.png` });
    // Nach unten wischen schließt
    const box = await page.locator(".sheet").boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const x = box.x + box.width / 2;
    const touch = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", box.y + 60);
    for (let i = 1; i <= 8; i++) await touch("touchMove", box.y + 60 + i * 30);
    await touch("touchEnd", 0);
    await page.waitForTimeout(500);
    out[`zu-${scheme}`] = !(await page.$(".sync-sheet"));
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1), errors);
  await b.close();
})();
