// Zustand bewerten (Goldmine) und Pressung anzeigen
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    const posts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => /\/fields\/\d+$/.test(r.url()) && posts.push(`${r.method()} ${r.url().split("/instances/")[1]} ${r.postData()}`));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.waitForTimeout(2000);
    await page.goto("http://localhost:8787/release/4");
    await page.waitForSelector("text=In deiner Kiste");
    await page.waitForTimeout(1500);
    const before = await page.locator(".grade-pill b").allTextContents();
    const matrix = await page.locator(".pressing .mono span").allTextContents();
    await page.locator(".grade-pill").first().click();
    await page.waitForSelector(".grade-opt");
    await page.screenshot({ path: `${__dirname}/grade-sheet-${scheme}.png` });
    await page.click(".grade-opt >> text=VG+");
    await page.waitForTimeout(800);
    const after = await page.locator(".grade-pill b").allTextContents();
    await page.locator("text=Pressung").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${__dirname}/grade-pressing-${scheme}.png` });
    await page.goto("http://localhost:8787/collection");
    await page.waitForTimeout(1200);
    const tags = await page.locator(".grade-tag").count();
    console.log(scheme, "| vorher", before, "| nachher", after, "| Matrix", matrix.length, "| POST", posts, "| Tags in Liste", tags, "| errors", errors);
    await ctx.close();
  }
  await b.close();
})();
