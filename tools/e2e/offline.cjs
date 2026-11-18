// Cover für ohne Netz: die Bilder der Platten eines Sets werden über den eigenen Server gesichert
// und stehen danach auch ohne Verbindung bereit. Dazu: Setliste als Druckseite.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let proxied = 0;
  await install(page);
  await page.route("**/api/img**", (r) => (proxied++, r.fulfill({ status: 200, contentType: "image/png", body: PNG })));
  await page.route("https://i.discogs.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.goto(B + "/");
  await page.waitForSelector("text=45 Platten");
  await page.waitForTimeout(8000);
  // Die Testdaten haben keine Discogs-Bilder: echte Adressen eintragen
  await page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open("crate");
    q.onsuccess = () => {
      const tx = q.result.transaction("releases", "readwrite");
      const st = tx.objectStore("releases");
      st.getAll().onsuccess = (e) => { for (const r of e.target.result) st.put({ ...r, thumb: `https://i.discogs.com/t/${r.id}.jpg`, cover: `https://i.discogs.com/c/${r.id}.jpg` }); };
      tx.oncomplete = res;
    };
  }));
  await page.goto(B + "/sets/new");
  await page.waitForSelector("input[placeholder^='Name']");
  await page.fill("input[placeholder^='Name']", "Freitag im Glashaus");
  await page.click("button:has-text('Automatik')", { timeout: 1500 }).catch(() => {});
  await page.click("button:has-text('Automatisch vorschlagen')", { timeout: 5000 }).catch(() => {});
  await page.click("button:has-text('Vorschlag erstellen')");
  await page.waitForSelector(".set-offline", { timeout: 20000 });
  await page.waitForFunction(() => /bereit/.test(document.querySelector(".set-offline")?.textContent ?? ""), null, { timeout: 20000 });
  const out = { zeile: await page.locator(".set-offline").innerText(), abrufe: proxied };
  out.imSpeicher = await page.evaluate(async () => {
    const c = await caches.open("covers");
    const keys = await c.keys();
    const first = keys.find((k) => k.url.includes("i.discogs.com"));
    const hit = first && (await c.match(first));
    return { anzahl: keys.filter((k) => k.url.includes("i.discogs.com")).length, art: hit?.type, typ: hit?.headers.get("content-type") };
  });
  // Setliste als Druckseite
  out.druckZeilen = await page.locator(".print-area [style*='break-inside']").count();
  await page.emulateMedia({ media: "print" });
  out.druckTitel = await page.locator(".print-area").innerText().then((t) => t.split("\n").slice(0, 4).join(" | "));
  await page.emulateMedia({ media: "screen" });
  // Zweiter Besuch: nichts wird neu geladen
  const before = proxied;
  await page.click("button:has-text('Speichern')");
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector(".set-offline", { timeout: 20000 });
  await page.waitForTimeout(2500);
  out.zeileNachNeuladen = await page.locator(".set-offline").innerText();
  out.erneutGeladen = proxied - before;
  console.log(JSON.stringify(out, null, 1), errors);
  await b.close();
})();
