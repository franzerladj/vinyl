// Kaufpreis: auf der Platten-Seite eintragen, landet in der Discogs-Notiz, zählt im Wert der Sammlung
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    globalThis.__fields = [];
    await install(page);
    await page.goto(`${B}/`);
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.goto(`${B}/release/4`);
    await page.waitForSelector(".paid-row input");
    await page.fill(".paid-row input", "50");
    await page.locator(".paid-row input").blur();
    await page.waitForTimeout(1500);
    const post = (globalThis.__fields || []).find((f) => /fields\/3$/.test(f.p));
    await page.locator(".paid-row").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${__dirname}/paid-release-${scheme}.png` });
    await page.goto(`${B}/collection`);
    await page.waitForSelector(".rec");
    await page.click("button[aria-label='Mehr']");
    await page.click(".option:has-text('Wert der Sammlung')");
    await page.waitForSelector("text=Was du bezahlt hast");
    const line = await page.locator(".card:has-text('Was du bezahlt hast') .sub").textContent();
    const top = await page.locator(".value-rec").first().textContent();
    await page.click("button:has-text('Kaufpreise eintragen')");
    await page.waitForSelector(".paid-input");
    await page.locator(".card:has-text('Was du bezahlt hast')").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${__dirname}/paid-sheet-${scheme}.png` });
    console.log(scheme, { post: post?.body, line, top, errors });
    await ctx.close();
  }
  await b.close();
})();
