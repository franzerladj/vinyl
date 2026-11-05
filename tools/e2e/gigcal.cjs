// Gig anlegen: Beginn/Ende, beim Speichern Kalender anbieten, Links für Google/Outlook
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
    await page.goto("http://localhost:8787/sets/new");
    await page.fill("input[placeholder^='Name']", "Freitag Klubraum");
    await page.fill("input[type=date]", "2027-03-12");
    await page.fill("input[placeholder=Location]", "Glashaus");
    await page.fill("input[type=time] >> nth=0", "22:00");
    await page.fill("input[type=time] >> nth=1", "04:00");
    await page.click("text=Speichern");
    await page.waitForSelector(".cal-sheet", { timeout: 8000 });
    await page.waitForTimeout(500);
    const text = await page.locator(".cal-sheet").innerText();
    await page.locator(".sheet").screenshot({ path: `${__dirname}/gigcal-${scheme}.png` });
    const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5000 }).catch(() => null), page.click("text=Google Kalender")]);
    const google = popup ? popup.url() : "-";
    await page.waitForTimeout(400);
    const btn = await page.locator(".gig-cal").textContent();
    console.log(scheme, JSON.stringify(text.split("\n").slice(0, 3)), "| Google:", google.slice(0, 90), "| Knopf:", btn, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
