// Eine Platte in mehreren Ordnern (Mock mit Beispielordnern: Auflegen = Platten 1–30, Metal = 31–35, Wants 46–48 in Metal).
// Der erste Ordner ist der echte Discogs-Ordner, jeder weitere steht als Marke in der Notiz des Exemplars.
const { chromium, devices } = require("playwright");
process.env.FOLDERS = "1";
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: process.env.DARK ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // „Seite verlassen?“ während ein Schritt zu Discogs unterwegs ist: ja
  page.on("dialog", (d) => d.accept().catch(() => undefined));
  await install(page);
  const st = page.__folders;
  const out = {};
  const label = () => page.locator(".action .action-label").first().textContent();
  const calls = (kind, id) => st.calls.filter((c) => c[0] === kind && c[1] === id);
  const settle = async (fn) => { for (let i = 0; i < 60 && !fn(); i++) await page.waitForTimeout(250); return fn(); };
  const openFolders = async (id) => {
    await page.goto(`${B}/release/${id}`);
    await page.waitForSelector(".action:has(.action-label)");
    await page.click(".action:has(.action-label)");
    await page.waitForSelector(".sheet .option");
  };
  // Das Blatt nimmt beim Schließen seinen Verlaufseintrag zurück: kurz warten, sonst bricht das nächste Laden ab
  const done = async () => { await page.click(".sheet .text-btn:has-text('Fertig')"); await page.waitForTimeout(500); };
  await page.goto(`${B}/`);
  await page.waitForSelector("text=45 Platten", { timeout: 30000 });
  await page.waitForTimeout(1500);

  // 1. Platte 3 liegt in „Auflegen“: zusätzlich in „Metal“. Sie wird nicht verschoben, „Metal“ kommt in die Notiz.
  await openFolders(3);
  out.vorher = await label();
  await page.click(".sheet .option:has-text('Metal')");
  await page.waitForFunction(() => document.querySelector(".action .action-label")?.textContent === "Auflegen, Metal", null, { timeout: 15000 });
  out.beide = await label();
  out.haken = await page.locator(".sheet .option[aria-pressed='true']").count();
  await page.screenshot({ path: `${__dirname}/multifolder-sheet.png` });
  await settle(() => calls("cnote", 3).length > 0);
  out.notizBeiDiscogs = calls("cnote", 3).at(-1)?.[2];
  out.nichtVerschoben = calls("move", 3).length === 0;
  await done();

  // 2. Sammlung: die Platte zählt in beiden Ordnern
  await page.goto(`${B}/collection`);
  await page.waitForSelector(".pager-pane.on .folder-tab");
  const tabs = async () => Object.fromEntries((await page.locator(".pager-pane.on .folder-tab").allTextContents()).map((t) => { const m = t.trim().match(/^(.*?)\s*(\d+)$/); return m ? [m[1], +m[2]] : [t.trim(), null]; }));
  out.zaehlung = await tabs();
  await page.click(".pager-pane.on .folder-tab:has-text('Metal')");
  await page.waitForTimeout(400);
  out.inMetal = await page.locator(".pager-pane.on .rec").count();

  // 3. Aus „Auflegen“ nehmen: „Metal“ rückt nach und wird der echte Discogs-Ordner, die Marke verschwindet
  await openFolders(3);
  await page.click(".sheet .option:has-text('Auflegen')");
  await page.waitForFunction(() => document.querySelector(".action .action-label")?.textContent === "Metal", null, { timeout: 15000 });
  await settle(() => calls("move", 3).length > 0 && calls("cnote", 3).length > 1);
  out.nachgerueckt = { ordner: st.fid[3], notiz: st.cnotes[3] };
  await done();

  // 4. Platte 40 ohne Ordner: erst „Auflegen“ (echter Ordner), dann „Metal“ (Marke), dann neuer Ordner „Sommer“
  await openFolders(40);
  await page.click(".sheet .option:has-text('Auflegen')");
  await page.click(".sheet .option:has-text('Metal')");
  await page.fill(".sheet input[placeholder='Neuer Ordner']", "Sommer");
  await page.click(".sheet button:has-text('Anlegen')");
  await page.waitForFunction(() => document.querySelector(".action .action-label")?.textContent === "Auflegen +2", null, { timeout: 15000 });
  out.drei = await label();
  await settle(() => /Sommer/.test(st.cnotes[40] ?? ""));
  out.platte40 = { ordner: st.fid[40], notiz: st.cnotes[40], sommerAngelegt: st.folders.some((f) => f.name === "Sommer") };
  await done();

  // 5. Want 46 (Metal) zusätzlich in „Auflegen“
  await openFolders(46);
  await page.click(".sheet .option:has-text('Auflegen')");
  await settle(() => calls("note", 46).length > 0);
  out.wantNotiz = calls("note", 46).at(-1)?.[2];
  await done();
  await page.goto(`${B}/wants`);
  await page.waitForSelector(".pager-pane.on .folder-tab");
  out.wantZaehlung = await tabs();

  // 6. Nach einem ganzen Abgleich (Notizen kommen von Discogs zurück) stimmt alles noch
  await page.goto(`${B}/collection`);
  await page.waitForSelector(".pager-pane.on .rec");
  await page.click("button[aria-label='Mehr']");
  await page.click(".option:has-text('Alles abgleichen')");
  await page.waitForTimeout(6000);
  out.nachAbgleich = await tabs();

  // 7. Set nur aus „Metal“: Platte 40 gehört dazu, obwohl sie bei Discogs in „Auflegen“ liegt
  const metal = st.folders.find((f) => f.name === "Metal").id;
  await page.goto(`${B}/sets/new`);
  await page.waitForSelector(".set-source");
  await page.click(".set-source .chip:has-text('Metal')");
  await page.click("button:has-text('Automatisch vorschlagen')");
  await page.click("button:has-text('Vorschlag erstellen')");
  await page.waitForTimeout(600);
  await page.click("button:has-text('Speichern')");
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("sets").objectStore("sets").getAll(); g.onsuccess = () => r(g.result.at(-1)); }; }));
  const rids = [...new Set(saved.trackIds.map((t) => +t.split(":")[0]))].sort((a, c) => a - c);
  out.setPlatten = rids;

  // 8. Ordner „Metal“ löschen: Platte 40 bleibt in „Auflegen“ und „Sommer“, 31–35 sind ohne Ordner, Wants verlieren die Marke
  await page.goto(`${B}/collection`);
  await page.waitForSelector(".pager-pane.on .rec");
  await page.click("button[aria-label='Mehr']");
  await page.click(".option:has-text('Ordner')");
  await page.click(".sheet .option:has-text('Metal')");
  await page.click(".folder-sorter button:has-text('Ordner löschen')");
  await page.click(".ask-backdrop button:has-text('Löschen')");
  await settle(() => st.calls.some((c) => c[0] === "delete" && c[1] === metal));
  await page.waitForTimeout(800);
  out.geloescht = { ordnerWeg: !st.folders.some((f) => f.name === "Metal"), platte40: st.cnotes[40], platte3: st.fid[3], platte31: st.fid[31], want46: calls("note", 46).at(-1)?.[2] };
  await page.goto(`${B}/release/40`);
  await page.waitForSelector(".action:has(.action-label)");
  out.platte40Danach = await label();
  console.log(JSON.stringify(out, null, 1), errors);
  await b.close();
})();
