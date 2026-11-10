// Desktop-Ansicht: wichtigste Seiten bei Laptop- und Monitor-Breite, hell und dunkel
// node tools/e2e/desk.cjs <ordner> [breite]
const { chromium } = require("playwright");
const install = require("./mock.cjs");
const out = process.argv[2] || `${__dirname}/desk`;
const W = Number(process.argv[3] || 1440);
const PAGES = [["home", "/"], ["coll", "/collection"], ["wants", "/wants"], ["release", "/release/4"], ["sets", "/sets"], ["setnew", "/sets/new"], ["dig", "/dig"], ["search", "/search"], ["settings", "/settings"], ["shop", "/shop"], ["friends", "/friends"]];
(async () => {
  require("fs").mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  for (const scheme of (process.env.SCHEMES || "light,dark").split(",")) {
    const ctx = await b.newContext({ viewport: { width: W, height: Math.round(W * 0.6) }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    await page.waitForTimeout(2500);
    for (const [name, path] of PAGES) {
      await page.goto(`http://localhost:8787${path}`);
      await page.waitForTimeout(1600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await page.screenshot({ path: `${out}/${name}-${scheme}.png` });
      if (overflow > 0) errors.push(`${name}: ${overflow}px zu breit`);
    }
    await page.goto("http://localhost:8787/collection");
    await page.waitForSelector(".rec");
    await page.click("button:has-text('Filter')");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/sheet-${scheme}.png` });
    console.log(scheme, W, errors);
    await ctx.close();
  }
  await b.close();
})();
