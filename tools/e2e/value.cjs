// Wert der Sammlung: Gesamtwert im Kopf, Blatt mit den wertvollsten, Sortierung nach Wert
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
    await page.goto("http://localhost:8787/collection");
    await page.waitForSelector(".value-line", { timeout: 20000 });
    const head = await page.locator(".value-line").innerText();
    await page.locator(".page-head").screenshot({ path: `${__dirname}/value-head-${scheme}.png` });
    await page.click(".value-line");
    await page.waitForSelector(".value-big");
    const before = await page.locator(".sheet .card b").first().innerText();
    await page.click("text=/Fehlende laden/");
    await page.waitForSelector("text=Einzelwerte geladen", { timeout: 180000 });
    await page.waitForTimeout(500);
    await page.locator(".sheet").screenshot({ path: `${__dirname}/value-sheet-${scheme}.png` });
    const first = await page.locator(".value-rec").first().innerText();
    await page.click("text=Alle nach Wert");
    await page.waitForTimeout(800);
    const rows = await page.locator(".rec .tiny.mono").allInnerTexts();
    const nums = rows.slice(0, 8).map((t) => Number(t.replace(/[^\d,]/g, "").replace(",", ".")));
    const sorted = nums.every((n, i) => i === 0 || nums[i - 1] >= n);
    console.log(scheme, JSON.stringify(head), "|", before, "|", JSON.stringify(first.split("\n").slice(0, 4)), "| sortiert", sorted, nums.slice(0, 4), "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
