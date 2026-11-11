// Tempo gegenprüfen am Altbestand: Jamiroquai mit doppeltem Tempo aus der Datenbank (184, 195) und einem
// unpassenden Wert (130). Erwartung: 92 und 97,5, die 130 als „unsicher“ markiert, eigener Wert bleibt.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await install(page);
  await page.goto(`${B}/`);
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(6000);
  // Altbestand wie bei Franz: Werte direkt in bpm, Migration noch nicht gelaufen
  await page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open("crate");
    q.onsuccess = () => {
      const tx = q.result.transaction(["releases", "tracks", "kv"], "readwrite");
      const r = tx.objectStore("releases");
      const g = r.get(9);
      g.onsuccess = () => r.put({ ...g.result, styles: ["Acid Jazz", "Soul"], artist: "Jamiroquai", title: "Virtual Insanity" });
      const t = tx.objectStore("tracks");
      const base = { releaseId: 9, artist: "Jamiroquai", lookedUpAt: 1, analyzedAt: 1 };
      // Positionen der Testplatte 9 im Mock: A, AA1, AA2
      for (const k of ["9:A", "9:AA1", "9:AA2"]) t.delete(k);
      t.put({ ...base, id: "9:A", position: "A", title: "Virtual Insanity", bpm: 184, bpmSource: "Deezer (Album)" });
      t.put({ ...base, id: "9:AA1", position: "AA1", title: "Bullet", bpm: 195, bpmSource: "Deezer (Album)" });
      t.put({ ...base, id: "9:AA2", position: "AA2", title: "Virtual Insanity (Album Version)", bpm: 130, bpmSource: "Deezer" });
      t.put({ ...base, id: "9:X", position: "X", title: "Eigener Wert", bpm: 101, bpmSource: "manuell" });
      tx.objectStore("kv").delete("migration-tempocheck-v");
      tx.oncomplete = res;
    };
  }));
  await page.reload();
  await page.waitForTimeout(5000);
  const tracks = await page.evaluate(() => new Promise((res) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("tracks").objectStore("tracks").getAll(); g.onsuccess = () => res(g.result.filter((t) => t.releaseId === 9)); }; }));
  const show = Object.fromEntries(tracks.map((t) => [t.position, `${t.bpm} ${t.tempoCheck} (${t.bpmSource})`]));
  console.log("daten", JSON.stringify(show));
  await page.goto(`${B}/release/9`);
  await page.waitForSelector(".bpm");
  const unsureShown = await page.locator(".bpm-unsure").count();
  await page.locator("tr:has(.bpm-unsure)").first().click();
  await page.waitForSelector(".tempo-check");
  await page.screenshot({ path: `${__dirname}/tempocheck.png` });
  await page.goto(`${B}/collection`);
  await page.waitForSelector(".rec");
  const btn = await page.locator(".tool-btn:has-text('Tempo prüfen')").textContent().catch(() => null);
  console.log(JSON.stringify({ show, unsureShown, btn, errors }, null, 1));
  await b.close();
})();
