// Kontowechsel auf einem Gerät: Daten des vorherigen Kontos werden entfernt
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await install(page);
  await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  const count = () => page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const t = q.result.transaction(["collection", "kv"]); const a = t.objectStore("collection").count(); const o = t.objectStore("kv").get("owner"); t.oncomplete = () => r({ coll: a.result, owner: o.result?.value }); }; }));
  const before = await count();
  // Simulieren: zuletzt war ein anderes Konto auf dem Gerät angemeldet
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const t = q.result.transaction("kv", "readwrite"); t.objectStore("kv").put({ key: "owner", value: "jemand_anderes" }); t.oncomplete = r; }; }));
  await page.evaluate(() => localStorage.setItem("crate_anthropic_key", "sk-ant-alt"));
  await page.reload();
  const toast = await page.waitForSelector("text=/Daten des vorherigen Kontos/", { timeout: 15000 }).then(() => true, () => false);
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  const after = await count();
  const key = await page.evaluate(() => localStorage.getItem("crate_anthropic_key"));
  console.log({ before, toast, after, keyRemoved: key === null });
  await b.close();
})();
