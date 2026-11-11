// Rückfragen im Crate-Stil: kein Browser-Dialog, Abbrechen und Bestätigen wirken
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [["iphone-dark", { ...devices["iPhone 13"], colorScheme: "dark" }], ["desk-light", { viewport: { width: 1440, height: 860 }, colorScheme: "light" }]]) {
    const ctx = await b.newContext(opts);
    const page = await ctx.newPage();
    const native = [];
    const errors = [];
    // „Seite verlassen?“ während eines Syncs kann nur der Browser selbst fragen
    page.on("dialog", (d) => (d.type() === "beforeunload" ? d.accept() : (native.push(d.message()), d.dismiss())));
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => (window.print = () => undefined));
    await page.goto(`${B}/`);
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.goto(`${B}/stickers?ids=2,9`);
    await page.waitForTimeout(1500);
    await page.click("button:has-text('Drucken')");
    await page.waitForSelector(".ask");
    const title = await page.locator(".ask-title").textContent();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${__dirname}/ask-${name}.png` });
    await page.keyboard.press("Escape");
    const closed = (await page.locator(".ask").count()) === 0;
    await page.click("button:has-text('Drucken')");
    await page.click(".ask button:has-text('Markieren')");
    await page.waitForTimeout(500);
    const marked = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("recordMeta").objectStore("recordMeta").get(2); g.onsuccess = () => r(Boolean(g.result?.stickerPrintedAt)); }; }));
    console.log(name, { title, escSchliesst: closed, markiert: marked, browserDialoge: native.length, errors });
    await ctx.close();
  }
  await b.close();
})();
