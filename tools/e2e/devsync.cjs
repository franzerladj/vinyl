// Abgleich Handy <-> Laptop: eigene BPM und Sets wandern mit, eine Messung überschreibt keinen eigenen Wert
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
const idb = (page, store, key) => page.evaluate(([s, k]) => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = k == null ? q.result.transaction(s).objectStore(s).getAll() : q.result.transaction(s).objectStore(s).get(k); g.onsuccess = () => r(g.result); }; }), [store, key]);
async function device(b, opts) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await install(page);
  await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
  await page.goto(`${B}/`);
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(3000);
  return page;
}
(async () => {
  globalThis.__devsync = undefined;
  globalThis.__devsyncShared = true;
  const b = await chromium.launch();
  const out = {};
  // Handy: BPM von Hand eintragen, Set anlegen
  const phone = await device(b, { ...devices["iPhone 13"] });
  await phone.goto(`${B}/release/4`);
  await phone.waitForSelector("tr td.pos");
  await phone.locator("tr:has(td.pos)").first().click();
  await phone.waitForSelector("text=Speichern");
  await phone.locator("label.field:has-text('BPM') input").fill("124.5");
  await phone.click("button:has-text('Speichern')");
  await phone.waitForTimeout(500);
  const tracks4 = (await idb(phone, "tracks")).filter((t) => t.releaseId === 4);
  const edited = tracks4.find((t) => t.bpm === 124.5);
  out.handyEigenerWert = edited ? `${edited.id} ${edited.bpm} ${edited.bpmSource}` : null;
  await phone.goto(`${B}/sets/new`);
  await phone.fill("input[placeholder^='Name']", "Freitag Glashaus");
  await phone.click("button:has-text('Speichern')");
  await phone.waitForTimeout(600);
  await phone.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await phone.waitForTimeout(5500); // Ausgang wird nach 4 s geschickt

  // Laptop: frisch, holt alles ab
  const laptop = await device(b, { viewport: { width: 1440, height: 860 } });
  await laptop.waitForTimeout(2000);
  const lt = await idb(laptop, "tracks", edited?.id);
  out.laptopBpm = lt ? `${lt.bpm} ${lt.bpmSource}` : null;
  const sets = await idb(laptop, "sets");
  out.laptopSets = sets.map((s) => s.name);
  // Laptop benennt das Set um
  await laptop.goto(`${B}/sets`);
  await laptop.click("text=Freitag Glashaus");
  await laptop.waitForSelector("input[placeholder^='Name']");
  await laptop.fill("input[placeholder^='Name']", "Freitag Glashaus (Peak)");
  await laptop.click("button:has-text('Speichern')");
  await laptop.waitForTimeout(5500);
  out.serverSets = [...globalThis.__devsync.rows.values()].filter((r) => r.t === "sets").map((r) => r.k + "=" + JSON.stringify(r.v?.name) + "@" + r.seq);
  out.laptopSets2 = (await idb(laptop, "sets")).map((s) => s.createdAt + "=" + s.name);
  // Handy kommt zurück in den Vordergrund und holt ab
  await phone.reload();
  await phone.waitForTimeout(4000);
  out.handySets = (await idb(phone, "sets")).map((s) => s.createdAt + "=" + s.name);
  out.handySeq = (await idb(phone, "kv", "devsyncSeq"))?.value;
  out.pushes = globalThis.__devsync?.pushes;
  out.fehler = [...phone.errors, ...laptop.errors];
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
