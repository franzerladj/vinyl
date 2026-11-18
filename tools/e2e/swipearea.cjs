// Umschalter mit gemeinsamer Liste per Wisch: Freund-Seite (Sammlung, Wants, Gemeinsam) und Set-Editor (Reihenfolge, Kiste)
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  const cdp = await ctx.newCDPSession(page);
  const sel = () => page.evaluate(() => document.querySelector(".seg [aria-selected=true]")?.textContent ?? "-");
  const swipe = async (x0, x1, y) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(800);
  };
  const out = {};
  await page.goto("http://localhost:8787/friends?add=kumpel");
  await page.waitForTimeout(800);
  await page.click("text=Hinzufügen");
  await page.waitForTimeout(6000);
  await page.goto("http://localhost:8787/friends/kumpel");
  await page.waitForSelector(".seg");
  await page.waitForTimeout(2500);
  let box = await page.locator(".seg").boundingBox();
  const y = Math.min(520, box.y + 160);
  await page.locator(".seg button").first().click(); // Sammlung des Freunds
  await page.waitForTimeout(500);
  out.friend = [await sel()];
  await swipe(330, 90, y); out.friend.push(await sel());
  await swipe(330, 90, y); out.friend.push(await sel());
  await swipe(90, 330, y); out.friend.push(await sel());
  out.sichtbar = await page.evaluate(() => { const el = document.querySelector(".seg").nextElementSibling; return getComputedStyle(el).opacity; });
  // Beschriften: Einleger, Obi, Sticker
  await page.goto("http://localhost:8787/stickers");
  await page.waitForSelector(".seg");
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  out.label = [await sel()];
  // Auf dem Erklärtext wischen (in der Vorschau darunter gehört der Wisch der Vorschau)
  const py = (await page.locator(".page.stack > .stack > p.sub").first().boundingBox()).y + 12;
  out.py = Math.round(py);
  await swipe(330, 90, py); out.label.push(await sel());
  await swipe(330, 90, py); out.label.push(await sel());
  await swipe(90, 330, py); out.label.push(await sel());
  await page.goto("http://localhost:8787/sets/new");
  await page.waitForSelector(".seg");
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  box = await page.locator(".seg").last().boundingBox();
  const sel2 = () => page.evaluate(() => [...document.querySelectorAll(".seg")].pop().querySelector("[aria-selected=true]").textContent);
  out.set = [await sel2()];
  await swipe(330, 90, box.y + 90); out.set.push(await sel2());
  await swipe(90, 330, box.y + 90); out.set.push(await sel2());
  // Scannen: Barcode, Foto, Eingeben (auch auf dem Kamerabild)
  await page.goto("http://localhost:8787/scan");
  await page.waitForSelector(".seg");
  await page.waitForTimeout(1200);
  out.scan = [await sel()];
  await swipe(330, 90, 430); out.scan.push(await sel());
  await swipe(330, 90, 430); out.scan.push(await sel());
  await swipe(90, 330, 430); out.scan.push(await sel());
  console.log(JSON.stringify(out), errors);
  await b.close();
})();
