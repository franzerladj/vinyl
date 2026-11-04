// Crate-Profil: bearbeiten mit Vorschau, speichern; Profil eines Freundes ansehen
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
    await page.waitForTimeout(3000);
    await page.goto("http://localhost:8787/settings/profile");
    await page.waitForSelector("text=So sehen dich Freunde");
    await page.fill("input[placeholder='Bayreuth'], .pe-field input >> nth=0", "DJ Franz");
    await page.fill("textarea", "House, Disco und alles mit Groove. Resident im Glashaus Bayreuth.");
    for (const l of ["soundcloud.com/djfranz", "@djfranz", "feuerpfeil.de"]) {
      await page.fill("input[placeholder='Link einfügen']", l);
      await page.click("text=Hinzufügen");
    }
    await page.locator(".chips .chip").first().click();
    await page.locator(".chips .chip").nth(1).click();
    await page.fill("input[placeholder*='Platte']", "Alt");
    await page.waitForTimeout(600);
    await page.locator(".set-row:has(.chev:text('+'))").first().click().catch(() => {});
    await page.waitForTimeout(400);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${__dirname}/profile-edit-${scheme}.png` });
    await page.click("text=Profil speichern");
    await page.waitForTimeout(800);
    const saved = await page.locator(".toast").first().textContent().catch(() => "-");
    // Freund hinzufügen und ansehen
    await page.goto("http://localhost:8787/friends");
    await page.fill("input[placeholder*='Discogs-Name']", "kumpel");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);
    await page.goto("http://localhost:8787/friends/kumpel");
    await page.waitForSelector(".pcard-bio", { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${__dirname}/profile-friend-${scheme}.png` });
    console.log(scheme, "| gespeichert:", saved, "| Freund:", await page.locator(".pcard h1").textContent(), "| Links", await page.locator(".pcard-link").count(), "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
