// Vorher/Nachher-Bilder der wichtigsten Seiten (hell und dunkel): node tools/e2e/look.cjs <ordner>
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const out = process.argv[2] || `${__dirname}/look`;
const PAGES = [["home", "/"], ["collection", "/collection"], ["release", "/release/2"], ["sets", "/sets"], ["friend", "/friends/kumpel"]];
(async () => {
  require("fs").mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.goto("http://localhost:8787/friends");
    await page.fill("input[placeholder*='Discogs-Name']", "kumpel");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    for (const [name, path] of PAGES) {
      await page.goto(`http://localhost:8787${path}`);
      await page.waitForTimeout(2200);
      await page.evaluate(() => document.querySelectorAll(".toast, .jobs").forEach((e) => (e.style.display = "none")));
      if (name === "release") {
        // Hörprobe starten, damit sich die Platte dreht (Tonarm)
        await page.evaluate(() => document.querySelector("audio")?.dispatchEvent(new Event("play")));
        await page.waitForTimeout(900);
      }
      await page.screenshot({ path: `${out}/${name}-${scheme}.png` });
    }
    await ctx.close();
  }
  await b.close();
})();
