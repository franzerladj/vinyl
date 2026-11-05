// Jahresrückblick: Seite und Story-Karte
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.waitForTimeout(1500);
    await page.goto("http://localhost:8787/year/2026");
    await page.waitForSelector(".year-big");
    await page.waitForTimeout(800);
    const stats = await page.locator(".year .grid3").innerText().catch(() => "-");
    await page.screenshot({ path: `${__dirname}/year-${scheme}.png`, fullPage: true });
    await page.click("text=Als Story teilen");
    await page.waitForSelector(".sheet img", { timeout: 20000 });
    const src = await page.locator(".sheet img").getAttribute("src");
    const png = await page.evaluate(async (u) => { const r = await fetch(u); const bl = await r.blob(); const a = new Uint8Array(await bl.arrayBuffer()); let s = ""; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192)); return btoa(s); }, src);
    require("fs").writeFileSync(`${__dirname}/card-year.png`, Buffer.from(png, "base64"));
    console.log(scheme, stats.replace(/\n/g, " "), "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
