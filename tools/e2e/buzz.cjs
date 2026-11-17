// Soziales im Freunde-Feed: Aktivität mit Punkt am Tab, Gefällt mir, Kommentar, Empfehlen per langem Drücken
const { chromium, devices } = require("playwright");
process.env.BUZZ = "1";
const install = require("./mock.cjs");
const OUT = process.env.OUT || __dirname;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  const out = {};
  // Start: Hinweis auf Neuigkeiten und Punkt am Freunde-Tab
  await page.waitForSelector(".friend-nudge", { timeout: 15000 });
  out.nudge = await page.locator(".friend-nudge b").first().innerText();
  out.dot = await page.locator(".nav a.has-dot").count();
  // Freund anlegen, damit der Feed Beiträge hat
  await page.goto("http://localhost:8787/friends?add=kumpel");
  await page.waitForTimeout(800);
  await page.click("text=Hinzufügen");
  await page.waitForTimeout(7000);
  await page.goto("http://localhost:8787/friends");
  await page.waitForSelector(".activity");
  out.activity = await page.locator(".activity-row").count();
  await page.waitForSelector(".fpost-bar");
  await page.locator(".fpost").first().scrollIntoViewIfNeeded();
  await page.locator(".fpost-act").first().click();
  await page.waitForTimeout(400);
  out.liked = await page.locator(".fpost-liked").first().innerText();
  await page.locator(".fpost").first().locator(".fpost-act").nth(1).click();
  await page.waitForSelector(".thread-form input");
  await page.waitForTimeout(400);
  await page.fill(".thread-form input", "Wo hast du die her?");
  await page.click(".thread-form button");
  await page.waitForSelector(".thread-row");
  out.comment = await page.locator(".thread-text").first().innerText();
  await page.screenshot({ path: `${OUT}/buzz-thread.png` });
  await page.goBack(); // Zurück schließt das Blatt
  await page.waitForTimeout(500);
  out.last = await page.locator(".fpost-last").first().innerText();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/buzz-friends.png` });
  out.gelesen = await page.evaluate(() => globalThis.fetch("/api/buzz").then((r) => r.json()).then((j) => j.unread));
  console.log(JSON.stringify(out), errors);
  await b.close();
})();
