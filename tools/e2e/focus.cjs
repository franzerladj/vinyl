// Tastatur am Computer: Blatt hält den Fokus (Tab läuft im Kreis), Esc schließt, der Fokus geht zurück an den Knopf.
// Umschalter (Seg) mit Pfeiltasten. Der Fokus-Ring verformt runde Knöpfe nicht mehr.
const { chromium } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten");
  const out = {};
  // Blatt per Tastatur öffnen
  await page.goto(B + "/collection");
  const btn = page.locator(".pager-pane.on button:has-text('Filter')").first();
  await btn.waitFor();
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sheet");
  await page.waitForTimeout(300);
  out.fokusImBlatt = await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet")));
  let drin = true;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    drin = drin && (await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet"))));
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    drin = drin && (await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet"))));
  }
  out.tabBleibtImBlatt = drin;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  out.blattZu = (await page.locator(".sheet").count()) === 0;
  out.fokusZurueck = await page.evaluate(() => document.activeElement?.textContent?.includes("Filter") ?? false);
  // Umschalter mit Pfeiltasten
  await page.goto(B + "/stickers");
  await page.waitForSelector(".seg [role=tab]");
  const vorher = await page.locator(".seg [aria-selected=true]").first().innerText();
  await page.locator(".seg [aria-selected=true]").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const nachher = await page.locator(".seg [aria-selected=true]").first().innerText();
  out.pfeil = `${vorher} -> ${nachher}`;
  out.fokusFolgt = await page.evaluate(() => document.activeElement?.getAttribute("aria-selected") === "true");
  out.nurEinsImTab = await page.evaluate(() => document.querySelector(".seg").querySelectorAll('[role=tab][tabindex="0"]').length);
  // Fokus-Ring lässt die Form in Ruhe
  out.radiusBeiFokus = await page.evaluate(() => {
    const el = document.querySelector(".btn");
    const r0 = getComputedStyle(el).borderRadius;
    el.focus();
    return `${r0} = ${getComputedStyle(el).borderRadius}`;
  });
  console.log(JSON.stringify(out, null, 1), errors);
  await b.close();
})();
