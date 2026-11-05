// Nadel-Stunden: einrichten, Sessions eintragen, Erinnerung auf Start
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
    await page.goto("http://localhost:8787/settings/stylus");
    await page.waitForSelector(".stylus-hero");
    await page.click("text=+3 Std.");
    await page.click("text=+3 Std.");
    await page.fill("input[inputmode=numeric]", "6");
    await page.locator("input[type=date]").click();
    await page.waitForTimeout(600);
    const big = await page.locator(".stylus-hero .value-big").textContent();
    const sub = await page.locator(".stylus-hero .sub").textContent();
    await page.screenshot({ path: `${__dirname}/stylus-${scheme}.png` });
    await page.goto("http://localhost:8787/");
    const remind = await page.waitForSelector("text=Nadel bald wechseln", { timeout: 8000 }).then(() => true, () => false);
    await page.goto("http://localhost:8787/settings");
    const row = await page.locator(".set-row:has-text('Nadel-Stunden')").innerText().catch(() => "-");
    console.log(scheme, big, "|", sub, "| Start-Erinnerung:", remind, "| Zeile:", row.replace(/\n/g, " "), "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
