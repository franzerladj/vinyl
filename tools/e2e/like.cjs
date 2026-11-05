// Digging: Like (Knopf, Doppeltippen), Likes-Liste, nichts landet auf der Wantlist
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const [name, dev] of [["iphone13", devices["iPhone 13"]], ["se", devices["iPhone SE"]]]) {
    const ctx = await b.newContext({ ...dev });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const wantCalls = [];
    page.on("request", (r) => /\/wants\/\d+/.test(r.url()) && r.method() === "PUT" && wantCalls.push(r.url()));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.goto("http://localhost:8787/dig");
    await page.waitForSelector(".dig-bar", { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.locator(".dig-bar button[aria-label='Like']").first().dispatchEvent("click");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${__dirname}/like-${name}.png` });
    const pressed = await page.locator(".dig-bar button[aria-label='Like']").first().getAttribute("aria-pressed");
    const weights = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("kv").objectStore("kv").get("digLiked"); g.onsuccess = () => r((g.result?.value ?? []).length); }; }));
    await page.locator(".dig-liked-btn").dispatchEvent("click");
    await page.waitForSelector(".dig-liked-row");
    const rows = await page.locator(".dig-liked-row").count();
    await page.screenshot({ path: `${__dirname}/like-list-${name}.png` });
    console.log(name, { pressed, stored: weights, rows, wantCalls: wantCalls.length, errors });
    await ctx.close();
  }
  await b.close();
})();
