// Teilen-Karten: Profil und Set als Story-Bild erzeugen und als PNG ablegen
const { chromium, devices } = require("playwright");
const fs = require("fs");
const install = require("./mock.cjs");
const grab = async (page, file) => {
  await page.waitForSelector(".share-preview img", { timeout: 20000 });
  const b64 = await page.evaluate(async () => {
    const src = document.querySelector(".share-preview img").src;
    const buf = await (await fetch(src)).arrayBuffer();
    let s = "";
    new Uint8Array(buf).forEach((x) => (s += String.fromCharCode(x)));
    return btoa(s);
  });
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.waitForTimeout(30000);
  // Profil
  await page.goto("http://localhost:8787/settings/profile");
  await page.waitForSelector("text=So sehen dich Freunde");
  await page.locator(".pe-field input").first().fill("DJ Franz");
  await page.fill("textarea", "House, Disco und alles mit Groove. Resident im Glashaus Bayreuth, freitags ab 23 Uhr.");
  for (const l of ["soundcloud.com/djfranz", "@djfranz"]) {
    await page.fill("input[placeholder='Link einfügen']", l);
    await page.click("text=Hinzufügen");
  }
  for (let i = 0; i < 3; i++) await page.locator(".chips .chip").nth(i).click();
  await page.fill("input[placeholder*='Platte']", "Can You");
  await page.waitForTimeout(700);
  await page.locator(".pick-row").first().click();
  await page.click("text=Als Story teilen");
  await grab(page, `${__dirname}/card-profile.png`);
  await page.keyboard.press("Escape");
  // Set
  await page.goto("http://localhost:8787/sets/new");
  await page.fill("input[placeholder*='Name']", "Freitag Glashaus");
  await page.click("text=Kiste packen");
  await page.waitForSelector(".pick-rec");
  for (let i = 0; i < 12; i++) await page.locator(".pick-rec").nth(i).click();
  await page.click("text=/Fertig/");
  await page.click(".seg >> text=/Reihenfolge/");
  for (let i = 0; i < 10; i++) {
    await page.locator(".next-panel .next-add").first().click();
    await page.waitForTimeout(150);
  }
  await page.click("text=Teilen");
  await page.click("text=Als Story-Bild (Instagram)");
  await grab(page, `${__dirname}/card-set.png`);
  console.log("errors", errors);
  await b.close();
})();
