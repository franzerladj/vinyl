const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.goto("http://localhost:8787/shop");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: __dirname + "/shop1.png" });
  await page.click(".seg >> text=Händler").catch(()=>page.click("text=Händler"));
  await page.fill("input[placeholder='Name oder Shop-Link']", "https://www.discogs.com/de/seller/Kumpel_Records/profile, other");
  await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + "/shop2.png", fullPage: true });
  console.log("errors", errors);
  await b.close();
})();
