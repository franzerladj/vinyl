// Langes Drücken auf eine Platte öffnet das Schnellmenü, ohne die Platte zu öffnen
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.goto("http://localhost:8787/collection");
  await page.waitForSelector(".pager-pane.on .rec");
  await page.waitForTimeout(1500);
  const box = await page.locator(".pager-pane.on .rec").nth(1).boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 120, y: box.y + 20 }] });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => ({ menu: [...document.querySelectorAll(".ctx-menu button")].map((b) => b.textContent), path: location.pathname }));
  await page.screenshot({ path: (process.env.OUT || __dirname) + "/ctxmenu.png" });
  // Passt das Menü auch auf einen kleinen Bildschirm?
  const fits = await page.evaluate(() => { const r = document.querySelector(".ctx-body").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  // In die Kiste für ein Set: ohne Set gibt es einen Hinweis, mit Set landet die Platte in der Kiste
  await page.click(".ctx-menu button:has-text('In die Kiste')");
  await page.waitForSelector(".sheet h3:has-text('In welche Kiste?')");
  const ohneSet = await page.locator(".sheet .sub").innerText().catch(() => "");
  await page.keyboard.press("Escape");
  await page.evaluate(() => new Promise((res) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const tx = q.result.transaction("sets", "readwrite"); tx.objectStore("sets").put({ name: "Freitag Glashaus", curve: "journey", trackIds: [], crateIds: [], createdAt: Date.now(), mixNotes: {}, date: "2027-01-15" }); tx.oncomplete = res; }; }));
  const press = async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 120, y: box.y + 20 }] });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500);
  };
  // Das Set wurde an der App vorbei geschrieben: neu laden, damit sie es kennt
  await page.reload();
  await page.waitForSelector(".pager-pane.on .rec");
  await page.waitForTimeout(1500);
  await press();
  await page.click(".ctx-menu button:has-text('In die Kiste')");
  await page.click(".sheet .option:has-text('Freitag Glashaus')");
  await page.waitForTimeout(600);
  const kiste = await page.evaluate(() => new Promise((res) => { const q = indexedDB.open("crate"); q.onsuccess = () => { q.result.transaction("sets").objectStore("sets").getAll().onsuccess = (e) => res(e.target.result.map((x) => x.crateIds.length)); }; }));
  // Ordner direkt aus dem Menü
  await press();
  await page.click(".ctx-menu button:has-text('Ordner')");
  await page.waitForSelector(".sheet h3:has-text('In welche Ordner?')");
  const ordnerBlatt = true;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await press();
  await page.click(".ctx-menu button:has-text('Platte öffnen')");
  await page.waitForTimeout(800);
  console.log({ open, fits, ohneSet: ohneSet.slice(0, 40), kiste, ordnerBlatt, after: new URL(page.url()).pathname, errors });
  await b.close();
})();
