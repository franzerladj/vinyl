// Einsortieren hängt nicht: eine Verschiebung antwortet nie, mittendrin wird die App neu geladen.
// Erwartung: sofort lokal einsortiert, danach alle Verschiebungen bei Discogs angekommen.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  const st = page.__folders;
  let hung = 0;
  await page.route(/\/collection\/folders\/\d+\/releases\/\d+\/instances\/\d+$/, (route) => {
    if (route.request().method() === "POST" && hung === 0) { hung++; return; } // nie beantworten
    return route.fallback();
  });
  const t0 = Date.now();
  await page.goto(`${B}/`);
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goto(`${B}/collection`);
  await page.waitForSelector(".rec");
  await page.click("button[aria-label='Mehr']");
  await page.click(".option:has-text('Ordner')");
  await page.fill("input[placeholder^='Erster Ordner']", "Auflegen");
  await page.click("button:has-text('Anlegen')");
  await page.waitForSelector(".folder-sorter");
  await page.click(".folder-sorter .chip:has-text('Deep House')");
  const marked = await page.locator(".folder-sorter .pick-rec").count();
  await page.click(".folder-sorter button:has-text('markieren')");
  const t1 = Date.now();
  await page.click(".folder-sorter button:has-text('Sichern')");
  await page.waitForSelector(`.folder-tab.on:has-text('${marked}')`, { timeout: 5000 });
  const instant = Date.now() - t1;
  // Nach ein paar Sekunden mittendrin neu laden (wie App schließen und öffnen)
  await page.waitForTimeout(23000);
  const before = st.calls.filter((c) => c[0] === "move").length;
  await page.reload();
  await page.waitForSelector(".rec");
  const stillTab = await page.locator(`.folder-tab.on:has-text('${marked}')`).count();
  let moved = 0;
  for (let i = 0; i < 90; i++) {
    moved = new Set(st.calls.filter((c) => c[0] === "move").map((c) => c[1])).size;
    if (moved >= marked) break;
    await page.waitForTimeout(1000);
  }
  const queue = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("kv").objectStore("kv").get("folderQueue"); g.onsuccess = () => r((g.result?.value ?? []).length); }; }));
  console.log({ marked, sofortMs: instant, vorNeuladen: before, nachNeuladenNochDa: stillTab, beiDiscogs: moved, offen: queue, haengend: hung, sekunden: Math.round((Date.now() - t0) / 1000), errors });
  await b.close();
})();
