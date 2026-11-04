// DJ-Übersicht auf der Startseite: Inhalte, Sprung in die gefilterte Sammlung
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
    await page.waitForSelector("text=Deine Kiste als DJ", { timeout: 90000 });
    await page.waitForTimeout(35000);
    const sec = page.locator(".djo");
    await sec.scrollIntoViewIfNeeded();
    await sec.screenshot({ path: `${__dirname}/djo-${scheme}.png` });
    if (scheme === "dark") {
      await page.locator(".djo-hist button.top").click();
      await page.waitForTimeout(1500);
      console.log("bpm chip", await page.locator("text=/\\d+–\\d+ BPM/").first().textContent().catch(() => "-"), "url", page.url());
      await page.goBack();
      await page.waitForTimeout(1200);
      await page.locator(".djo-wheel g[role=button]").filter({ has: page.locator("path[opacity='1']") }).first().click().catch(async () => page.locator(".djo-wheel g[role=button]").first().click());
      await page.waitForTimeout(1500);
      console.log("key chip", await page.locator("text=/passt zu/").first().textContent().catch(() => "-"));
    }
    console.log(scheme, "errors", errors);
    await ctx.close();
  }
  await b.close();
})();
