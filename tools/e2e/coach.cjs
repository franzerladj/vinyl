// Einführung vor dem ersten Diggen: Gesten, dann jeder Knopf mit Spotlight
process.env.COACH = "1";
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const [name, dev] of [["iphone13", devices["iPhone 13"]], ["se", devices["iPhone SE"]]]) {
    const ctx = await b.newContext({ ...dev });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.goto("http://localhost:8787/dig");
    await page.waitForSelector(".coach-card", { timeout: 30000 });
    const titles = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(500);
      titles.push(await page.locator(".coach-card b").textContent());
      if (i === 0 || i === 1 || i === 6) await page.screenshot({ path: `${__dirname}/coach-${name}-${i}.png` });
      await page.locator(".coach-next").dispatchEvent("click");
    }
    await page.waitForTimeout(400);
    const gone = !(await page.isVisible(".coach"));
    await page.reload();
    await page.waitForSelector(".dig-bar", { timeout: 30000 });
    await page.waitForTimeout(800);
    const again = await page.isVisible(".coach");
    console.log(name, titles.join(" › "), "| zu:", gone, "| wieder:", again, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
