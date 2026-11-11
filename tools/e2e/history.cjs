// Set-Verlauf: ein vergangenes Set markiert Tracks im neuen Set als „gespielt“
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
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
  await page.waitForTimeout(3000);
  await page.waitForSelector("text=Tracklists laden", { state: "detached", timeout: 120000 }).catch(() => {});
  // Vergangenes Set mit allen Tracks der ersten 8 Platten anlegen
  await page.evaluate(async () => {
    const open = indexedDB.open("crate");
    const idb = await new Promise((r) => (open.onsuccess = () => r(open.result)));
    const all = await new Promise((r) => { const q = idb.transaction("tracks").objectStore("tracks").getAll(); q.onsuccess = () => r(q.result); });
    const ids = all.filter((t) => t.releaseId <= 8).map((t) => t.id);
    const first = all.find((t) => t.releaseId === 1);
    first.cueIn = "Intro, 16 Takte";
    first.cueOut = "nach dem zweiten Drop";
    const tx = idb.transaction(["sets", "tracks"], "readwrite");
    tx.objectStore("tracks").put(first);
    tx.objectStore("sets").add({ name: "Letzter Freitag", date: new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10), venue: "Glashaus", curve: "build", trackIds: ids, createdAt: Date.now() - 20 * 864e5 });
    await new Promise((r) => (tx.oncomplete = r));
  });
  await page.goto("http://localhost:8787/sets/new");
  await page.click("text=Kiste packen");
  await page.waitForSelector(".pick-rec");
  for (let i = 0; i < 8; i++) await page.locator(".pick-rec").nth(i).click();
  await page.click("text=/Fertig \\(8\\)/");
  await page.waitForTimeout(500);
  await page.click(".seg >> text=/Reihenfolge/");
  await page.waitForTimeout(500);
  // Vorschläge aus der ganzen Sammlung, damit die Platten aus dem alten Set dabei sind
  await page.locator(".next-panel .seg button:has-text('Alle')").first().click().catch(() => {});
  await page.waitForTimeout(800);
  const chips = (await page.locator(".next-panel .next-reasons i").allTextContents()).filter((x) => x.startsWith("gespielt"));
  await page.screenshot({ path: `${__dirname}/history-next.png` });
  console.log("Chips:", chips.slice(0, 3), "| errors", errors);
  await b.close();
})();
