// Angemeldet bleiben, wenn der Server den Namen gerade nicht bestätigen kann (Discogs bremst ihn)
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
  let claimed = null;
  let identityCalls = 0;
  // Später registrierte Routen gehen vor
  await page.route("**/api/me", (r) => r.fulfill({ json: { username: null, verified: false, needIdentity: true, features: { claude: false, freeAi: true, lastfm: true, keyLookup: false, oauth: true } } }));
  await page.route("**/api/auth/claim", (r) => { claimed = JSON.parse(r.request().postData()).username; return r.fulfill({ json: { username: claimed, verified: false } }); });
  await page.route("**/api/auth/identity", (r) => { identityCalls++; return r.fulfill({ status: 503, json: { busy: true } }); });
  await page.goto("http://localhost:8787/");
  const home = await page.waitForSelector("text=45 Platten", { timeout: 30000 }).then(() => true, () => false);
  const login = await page.isVisible("text=Mit Discogs anmelden");
  await page.waitForTimeout(6500);
  console.log({ home, loginScreen: login, claimed, identityCalls, errors });
  await b.close();
})();
