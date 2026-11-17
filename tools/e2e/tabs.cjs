// Tab-Verlauf: jeder Tab behält Seite und Scroll-Position, zweites Antippen führt zur Startseite des Tabs
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const tab = (t) => page.click(`.nav >> text=${t}`);
  // Sammlung: runterscrollen, Platte öffnen
  await tab("Platten");
  await page.waitForSelector(".rec");
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(500);
  const yColl = await page.evaluate(() => Math.round(scrollY));
  await page.locator(".rec").nth(14).click();
  await page.waitForURL(/\/release\//);
  const relUrl = page.url();
  const aktivAufPlatte = (await page.locator(".nav a.active").innerText()).trim();
  // Sets, dann zurück zu Sammlung: wieder auf der Platte
  await tab("Sets");
  await page.waitForURL(/\/sets$/);
  await tab("Platten");
  await page.waitForTimeout(800);
  const zurueckAufPlatte = page.url() === relUrl;
  // Nochmal Sammlung antippen: zur Liste, dann Start und zurück: Scroll-Position der Liste
  await tab("Platten");
  await page.waitForURL(/\/collection$/);
  await page.waitForSelector(".rec");
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(500);
  const y2 = await page.evaluate(() => Math.round(scrollY));
  await tab("Start");
  await page.waitForTimeout(600);
  await tab("Platten");
  await page.waitForTimeout(1500);
  const yBack = await page.evaluate(() => Math.round(scrollY));
  // Aktiven Tab auf der Startseite antippen: nach oben
  await tab("Platten");
  await page.waitForTimeout(900);
  const yTop = await page.evaluate(() => Math.round(scrollY));
  console.log({ yColl, aktivAufPlatte, zurueckAufPlatte, y2, yBack, yTop, errors });
  await b.close();
})();
