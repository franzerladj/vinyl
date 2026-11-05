// Kisten-Vorlagen und Sets per Link teilen
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "light" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.addInitScript(() => {
    localStorage.setItem("crate:yt", "no");
    delete navigator.share; // Link landet in der Zwischenablage
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.waitForTimeout(3000);
  await page.waitForSelector("text=Tracklists laden", { state: "detached", timeout: 120000 }).catch(() => {});
  // Kiste packen und als Vorlage speichern
  await page.goto("http://localhost:8787/sets/new");
  await page.fill("input[placeholder^='Name']", "Freitag Deep");
  await page.click("text=Kiste packen");
  await page.waitForSelector(".pick-rec");
  for (let i = 0; i < 6; i++) await page.locator(".pick-rec").nth(i).dispatchEvent("click");
  await page.click("text=/Fertig \\(6\\)/");
  await page.waitForTimeout(700);
  await page.click("button.text-btn >> text=Vorlagen");
  await page.waitForTimeout(700);
  await page.screenshot({ path: __dirname + "/share-tpl0.png" });
  await page.click("text=Als Vorlage speichern", { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: __dirname + "/share-tpl.png" });
  await page.keyboard.press("Escape");
  await page.click(".sheet-backdrop", { position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(400);
  // Ein paar Tracks wählen, Notiz, dann Link teilen
  await page.click(".seg >> text=/Reihenfolge/");
  for (let i = 0; i < 4; i++) {
    await page.locator(".next-panel .next-add").first().click();
    await page.waitForTimeout(250);
  }
  await page.locator("button.transition").first().click();
  await page.fill("textarea", "lange Blende");
  await page.click("text=Notiz speichern");
  await page.click("text=Speichern");
  await page.waitForTimeout(600);
  await page.click("button.btn.small >> text=Teilen");
  await page.click("text=Link für Freunde (B2B)");
  await page.waitForTimeout(500);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  // Neues Set: Vorlage laden
  await page.goto("http://localhost:8787/sets/new");
  await page.waitForTimeout(800);
  await page.click("text=Vorlage laden");
  await page.click(".tpl-main >> text=Freitag Deep");
  await page.waitForTimeout(500);
  const crateTab = await page.locator(".seg >> text=/Kiste/").textContent();
  // Geteilten Link öffnen
  await page.goto(link);
  await page.waitForSelector("text=/Du hast \\d+ von \\d+ Platten/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: __dirname + "/share-open.png", fullPage: true });
  const summary = await page.locator("text=/Du hast \\d+ von \\d+ Platten/").textContent();
  const note = await page.locator("text=„lange Blende“").count();
  await page.click("text=Als eigenes Set übernehmen");
  await page.waitForURL(/\/sets\/\d+$/);
  await page.waitForTimeout(800);
  const adopted = await page.locator(".order-item").count();
  console.log("Link-Länge", link.length, "| Vorlage geladen:", crateTab, "|", summary, "| Notiz:", note, "| übernommen:", adopted, "| errors", errors);
  await b.close();
})();
