// Ordner: in der Sammlung anlegen und einsortieren, Wantlist teilt die Ordner, Kauf landet im Ordner, Set nur aus einem Ordner
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: process.env.DARK ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  const st = page.__folders;
  const out = {};
  await page.goto(`${B}/`);
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Sammlung: ohne Ordner keine Leiste, Ordner über das Menü anlegen
  await page.goto(`${B}/collection`);
  await page.waitForSelector(".rec");
  out.barBefore = await page.locator(".folder-tabs").count();
  await page.click("button[aria-label='Mehr']");
  await page.click(".option:has-text('Ordner')");
  await page.fill("input[placeholder^='Erster Ordner']", "Auflegen");
  await page.screenshot({ path: `${__dirname}/folders-new.png` });
  await page.click("button:has-text('Anlegen')");
  await page.waitForSelector(".folder-sorter");
  await page.click(".folder-sorter .chip:has-text('Deep House')");
  const marked = await page.locator(".folder-sorter .pick-rec").count();
  await page.click(".folder-sorter button:has-text('markieren')");
  await page.screenshot({ path: `${__dirname}/folders-sort.png` });
  await page.click(".folder-sorter button:has-text('Sichern')");
  await page.waitForFunction((n) => document.querySelector(".folder-tab.on, .folder-tab") && [...document.querySelectorAll(".folder-tab")].some((t) => t.textContent.includes("Auflegen") && t.textContent.includes(String(n))), marked, { timeout: 30000 });
  out.moved = st.calls.filter((c) => c[0] === "move").length;
  out.marked = marked;
  await page.waitForTimeout(400);
  out.selected = await page.locator(".folder-tab.on").textContent();
  out.listInFolder = await page.locator(".rec").count();
  await page.screenshot({ path: `${__dirname}/folders-coll.png` });

  // Wantlist: gleicher Ordner da, neuen Ordner „Metal“ anlegen und zwei Wants einsortieren
  await page.goto(`${B}/wants`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${__dirname}/folders-want0.png` });
  await page.waitForSelector(".rec");
  await page.click("button[aria-label='Mehr']");
  await page.click(".option:has-text('Ordner')");
  out.sharedInWants = await page.locator(".option-list .option:has-text('Auflegen')").count();
  await page.fill("input[placeholder='Neuer Ordner']", "Metal");
  await page.click("button:has-text('Anlegen')");
  await page.waitForSelector(".folder-sorter");
  await page.locator(".folder-sorter .pick-rec").nth(0).click();
  await page.locator(".folder-sorter .pick-rec").nth(1).click();
  await page.click(".folder-sorter button:has-text('Sichern')");
  await page.waitForFunction(() => [...document.querySelectorAll(".folder-tab")].some((t) => t.textContent.includes("Metal") && t.textContent.includes("2")), null, { timeout: 30000 });
  const notes = st.calls.filter((c) => c[0] === "note");
  out.notes = notes.map((c) => c[2]);
  await page.waitForTimeout(400);
  out.wantsInFolder = await page.locator(".rec").count();
  await page.screenshot({ path: `${__dirname}/folders-want.png` });

  // Gekauft: Want aus „Metal“ landet in der Sammlung im Ordner „Metal“
  const wid = notes[0][1];
  await page.goto(`${B}/release/${wid}`);
  await page.waitForSelector(".actions");
  out.releaseRow = await page.locator(".group-row:has-text('Ordner')").first().textContent();
  await page.click(".action:has-text('Sammlung')");
  await page.waitForFunction(() => [...document.querySelectorAll(".action")].some((a) => a.textContent.includes("Drucken")), null, { timeout: 15000 });
  const metal = st.folders.find((f) => f.name === "Metal");
  out.boughtInto = st.calls.find((c) => c[0] === "add")?.[2] === metal.id;

  // Set: nur aus „Auflegen“
  await page.goto(`${B}/sets/new`);
  await page.waitForSelector(".set-source");
  await page.click(".set-source .chip:has-text('Auflegen')");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${__dirname}/folders-set.png` });
  await page.click("button:has-text('Automatisch vorschlagen')");
  out.autoTitle = await page.locator("b:has-text('vorschlagen')").first().textContent();
  await page.click("button:has-text('Vorschlag erstellen')");
  await page.waitForTimeout(600);
  const auflegen = st.folders.find((f) => f.name === "Auflegen").id;
  const inFolder = new Set(Object.entries(st.fid).filter(([, f]) => f === auflegen).map(([id]) => +id));
  await page.click("button:has-text('Speichern')");
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("sets").objectStore("sets").getAll(); g.onsuccess = () => r(g.result.at(-1)); }; }));
  const rids = [...new Set(saved.trackIds.map((t) => +t.split(":")[0]))];
  out.setTracks = saved.trackIds.length;
  out.setFolder = saved.folderId === auflegen;
  out.setOnlyFromFolder = rids.length > 0 && rids.every((id) => inFolder.has(id));
  console.log(JSON.stringify(out, null, 1), errors);
  await b.close();
})();
