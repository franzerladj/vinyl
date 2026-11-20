// Nachricht und Leihanfrage, solange man auf Crate noch nicht befreundet ist: die Knöpfe sind da,
// ein Blatt erklärt, was fehlt (Anfrage offen, Einladung, solange über Discogs).
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const OUT = process.env.OUT || __dirname;
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const scheme of ["dark", "light"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten");
    // Freund über den Discogs-Namen hinzufügen: das schickt eine Anfrage, die noch niemand angenommen hat
    await page.goto(B + "/friends?add=kumpel");
    await page.waitForTimeout(800);
    await page.click("text=Hinzufügen");
    await page.waitForTimeout(7000);
    const out = {};
    await page.goto(B + "/friends/kumpel");
    await page.waitForSelector("button:has-text('Nachricht')");
    out.hinweis = await page.locator("text=Deine Anfrage ist noch offen").count();
    await page.click("button:has-text('Nachricht')");
    await page.waitForSelector(".connect");
    await page.waitForTimeout(500);
    out.titel = await page.locator(".connect h3").innerText();
    out.knoepfe = await page.locator(".connect .btn").allInnerTexts();
    await page.screenshot({ path: `${OUT}/dmask-freund-${scheme}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    // Platte, die der Freund hat und ich nicht: „Leihen?“ steht da und führt zum selben Blatt
    const rid = await page.evaluate(async () => {
      const req = indexedDB.open("crate");
      const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      const get = (st) => new Promise((res) => (db.transaction(st).objectStore(st).getAll().onsuccess = (e) => res(e.target.result)));
      const mine = new Set((await get("collection")).map((c) => c.releaseId));
      return (await get("friendItems")).filter((x) => x.kind === "coll" && !mine.has(x.releaseId))[0]?.releaseId ?? null;
    });
    await page.goto(`${B}/release/${rid}`);
    const btn = page.locator("button:has-text('Leihen?')");
    await btn.waitFor({ timeout: 15000 });
    await btn.first().scrollIntoViewIfNeeded();
    await btn.first().click();
    await page.waitForSelector(".connect");
    await page.waitForTimeout(500);
    out.leihenText = (await page.locator(".connect-text").innerText()).slice(0, 60);
    out.url = new URL(page.url()).pathname;
    await page.screenshot({ path: `${OUT}/dmask-platte-${scheme}.png` });
    console.log(scheme, JSON.stringify(out));
    await ctx.close();
  }
  console.log("errors", errors);
  await b.close();
})();
