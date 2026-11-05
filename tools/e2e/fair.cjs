// Plattenbörse: nach dem Suchen sofort sehen, ob man die Platte hat oder sucht
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    const out = [];
    for (const [name, catno] of [["have", "HAVE 1"], ["want", "WANT 9"]]) {
      await page.goto("http://localhost:8787/scan");
      await page.click("text=Eingeben");
      await page.fill("input >> nth=0", catno);
      await page.click("button:has-text('Suchen')");
      await page.waitForSelector(".verdict", { timeout: 20000 });
      await page.waitForTimeout(1500);
      out.push(await page.locator(".verdict").innerText());
      await page.locator(".verdict").screenshot({ path: `${__dirname}/fair-${name}-${scheme}.png` });
    }
    console.log(scheme, out.map((t) => t.replace(/\n/g, " | ")), errors);
    await ctx.close();
  }
  await b.close();
})();
