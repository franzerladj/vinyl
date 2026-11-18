// Bilder der Druck-Vorlagen (Einleger, Obi, Sticker) in Originalgröße, zum Beurteilen des Designs.
//   node tools/e2e/printlook.cjs <ordner> [ids]
// Zusätzlich entsteht je Art ein PDF, wie es der Druckdialog bekommt.
const { chromium } = require("playwright");
const install = require("./mock.cjs");
const out = process.argv[2] || __dirname;
const ids = process.argv[3] || "5,9,2,15";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.waitForTimeout(1500);
  await page.goto(`http://localhost:8787/stickers?ids=${ids}`);
  await page.waitForTimeout(1500);
  await page.click("text=Laden").catch(() => {});
  await page.waitForSelector("text=ohne Tracklist", { state: "detached", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000); // Tempo und Tonart aus dem Abgleich abwarten
  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.locator(".preview-scroll").screenshot({ path: `${out}/print-${name}.png` });
  };
  const steps = process.env.STEPS ? JSON.parse(process.env.STEPS) : [["card", []], ["obi", []], ["sticker", []]];
  for (const [kind, clicks, name] of steps) {
    await page.click(`.seg >> text=${{ card: "Einleger", obi: "Obi", sticker: "Sticker" }[kind]}`);
    for (const c of clicks) {
      if (c.startsWith("select:")) { const [, sel, val] = c.split(":"); await page.selectOption(sel, val); }
      else if (c.startsWith("fill:")) { const [, sel, val] = c.split("::").length > 1 ? ["", ...c.slice(5).split("::")] : []; await page.fill(sel, val); }
      else await page.click(c);
    }
    await shot(name || kind);
  }
  if (process.env.PDF) {
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${out}/print.pdf`, printBackground: true, preferCSSPageSize: true });
  }
  console.log("errors", errors);
  await b.close();
})();
