// Set erzeugen: ein Track pro Platte, nie dieselbe Platte hintereinander, Hinweis bei Notfall
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const readSet = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("crate");
        r.onsuccess = () => {
          const tx = r.result.transaction("sets", "readonly").objectStore("sets").getAll();
          tx.onsuccess = () => res(tx.result.at(-1)?.trackIds ?? []);
        };
      }),
  );
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
  await page.waitForTimeout(40000);
  for (const [len, per] of [[20, "Einer"], [60, "Einer"]]) {
    await page.goto("http://localhost:8787/sets/new");
    await page.click("text=Automatisch vorschlagen");
    await page.waitForSelector("text=Vorschlag erstellen");
    await page.locator(".field:has-text('Tracks') input").first().fill(String(len));
    await page.click(`.seg >> text=${per}`);
    await page.click("text=Vorschlag erstellen");
    await page.waitForTimeout(1500);
    const note = await page.locator(".sub[style*='warn']").textContent().catch(() => null);
    if (len === 20) await page.screenshot({ path: `${__dirname}/setgen-dark.png` });
    await page.click("text=Speichern");
    await page.waitForTimeout(1000);
    const ids = await readSet(page);
    const recs = ids.map((id) => id.split(":")[0]);
    const adjacent = recs.filter((r, i) => i && r === recs[i - 1]).length;
    const maxPer = Math.max(...[...new Set(recs)].map((r) => recs.filter((x) => x === r).length));
    console.log(`Länge ${len}: ${ids.length} Tracks, ${new Set(recs).size} Platten, max ${maxPer} pro Platte, ${adjacent} direkt hintereinander | Hinweis: ${note}`);
  }
  console.log("errors", errors);
  await b.close();
})();
