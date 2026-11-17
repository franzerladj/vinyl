// Neues Set in drei Fragen: Gig, Verlauf, Platten; danach steht der Vorschlag im Editor
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const OUT = process.env.OUT || __dirname;
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:test-wizard", "1"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    // Tracklists müssen da sein, sonst gibt es nichts vorzuschlagen
    await page.waitForFunction(() => !document.querySelector(".job-pill"), null, { timeout: 120000 }).catch(() => undefined);
    await page.goto("http://localhost:8787/sets/new");
    await page.waitForSelector(".wiz-q");
    await page.fill(".wiz-big", "Freitag Klubraum");
    await page.click(".chip:has-text('Morgen')");
    await page.click(".chip:has-text('3 Stunden')");
    await page.screenshot({ path: `${OUT}/wiz-${scheme}-1.png` });
    await page.click(".wiz-foot .btn.primary");
    await page.waitForSelector(".wiz-card");
    await page.click(".wiz-card:has-text('Warm-up')");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/wiz-${scheme}-2.png` });
    await page.click(".wiz-foot .btn.primary");
    await page.waitForSelector(".wiz-sum");
    await page.waitForTimeout(500);
    const sum = await page.locator(".wiz-sum").innerText();
    await page.screenshot({ path: `${OUT}/wiz-${scheme}-3.png` });
    await page.click("text=Vorschlag bauen lassen");
    await page.waitForSelector(".set-summary", { timeout: 15000 });
    const res = await page.evaluate(() => ({ name: document.querySelector(".page input.input").value, nums: document.querySelector(".set-summary-nums").innerText.replace(/\n/g, " "), curve: document.querySelector(".chips .chip.on")?.textContent }));
    await page.screenshot({ path: `${OUT}/wiz-${scheme}-4.png` });
    console.log(scheme, sum.replace(/\n/g, " "), res, errors);
    await ctx.close();
  }
  await b.close();
})();
