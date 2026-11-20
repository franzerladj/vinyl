// Nachrichten unter Freunden: Hinweis auf Start, Liste bei Freunde, Unterhaltung, Leihanfrage beantworten
// (trägt die Platte als verliehen ein), eigene Nachricht senden und löschen, Leihanfrage von der Platten-Seite.
const { chromium, devices } = require("playwright");
process.env.DM = "1";
const install = require("./mock.cjs");
const OUT = process.env.OUT || __dirname;
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const out = {};
  const errors = [];
  for (const scheme of ["dark", "light"]) {
    globalThis.__dm = undefined;
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten");
    // Start: Hinweis und Punkt am Freunde-Tab
    await page.waitForSelector("text=2 neue Nachrichten", { timeout: 15000 });
    out.dot = await page.locator(".nav a.has-dot").count();
    // Der Freund kommt über die bestätigte Freundschaft von selbst in die Liste; kurz warten, bis seine Sammlung da ist
    await page.waitForTimeout(7000);
    await page.goto(B + "/friends");
    await page.waitForSelector(".dm-row");
    out.preview = await page.locator(".dm-row .dm-last").first().innerText();
    out.badge = await page.locator(".dm-row .dm-n").first().innerText();
    await page.screenshot({ path: `${OUT}/dm-liste-${scheme}.png` });
    await page.locator(".dm-row").first().click();
    await page.waitForSelector(".chat-bubble");
    await page.waitForTimeout(900);
    out.bubbles = await page.locator(".chat-bubble").count();
    out.answerButtons = await page.locator(".chat-answer button").count();
    await page.screenshot({ path: `${OUT}/dm-chat-${scheme}.png` });
    // Leihanfrage zusagen: Antwort geht raus, Crate bietet an, die Platte als verliehen einzutragen
    await page.click("text=Klar, kannst du haben");
    await page.waitForSelector("text=Als verliehen eintragen?");
    await page.click(".ask-backdrop button:has-text('Eintragen')");
    await page.waitForTimeout(600);
    out.yes = await page.locator(".chat-bubble.is-yes").count();
    out.answerGone = (await page.locator(".chat-answer").count()) === 0;
    out.lent = await page.evaluate(async () => {
      const req = indexedDB.open("crate");
      const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      const all = await new Promise((res) => (db.transaction("recordMeta").objectStore("recordMeta").getAll().onsuccess = (e) => res(e.target.result)));
      return all.filter((m) => m.lentTo).map((m) => `${m.releaseId}:${m.lentTo}`);
    });
    // Eigene Nachricht
    await page.fill(".chat-input textarea", "Montag passt. Bring sie heil zurück.");
    await page.click(".chat-send");
    await page.waitForTimeout(600);
    out.sent = await page.locator(".chat-row.mine .chat-bubble p").last().innerText();
    await page.screenshot({ path: `${OUT}/dm-chat2-${scheme}.png` });
    // Antippen zeigt Uhrzeit und „Löschen“
    await page.locator(".chat-row.mine .chat-bubble").last().click();
    await page.click(".chat-del");
    await page.click(".ask-backdrop button:has-text('Löschen')");
    await page.waitForTimeout(500);
    out.afterDelete = await page.locator(".chat-bubble").count();
    // Gelesen: der Zähler in der Liste ist weg
    await page.goto(B + "/friends");
    await page.waitForSelector(".dm-row");
    out.badgeAfter = await page.locator(".dm-row .dm-n").count();
    // Leihanfrage von der Platten-Seite: eine Platte, die der Freund hat und ich nicht
    const rid = await page.evaluate(async () => {
      const req = indexedDB.open("crate");
      const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      const get = (st) => new Promise((res) => (db.transaction(st).objectStore(st).getAll().onsuccess = (e) => res(e.target.result)));
      const mine = new Set((await get("collection")).map((c) => c.releaseId));
      const theirs = (await get("friendItems")).filter((x) => x.kind === "coll" && !mine.has(x.releaseId));
      return theirs[0]?.releaseId ?? null;
    });
    out.friendRecord = rid;
    if (rid) {
      await page.goto(`${B}/release/${rid}`);
      const btn = page.locator("button:has-text('Leihen?')");
      await btn.waitFor({ timeout: 15000 }).catch(() => undefined);
      out.borrowButton = await btn.count();
      if (out.borrowButton) {
        await btn.first().scrollIntoViewIfNeeded();
        await btn.first().click();
        await page.waitForSelector(".chat-attach");
        await page.screenshot({ path: `${OUT}/dm-leihen-${scheme}.png` });
        await page.click(".chat-send");
        await page.waitForTimeout(600);
        out.borrowSent = await page.locator(".chat-row.mine .chat-bubble.is-borrow").count();
      }
    }
    out.calls = (globalThis.__dmCalls ?? []).filter((c) => c.startsWith("POST") && !c.includes("/read")).map((c) => c.slice(0, 90));
    globalThis.__dmCalls = [];
    console.log(scheme, JSON.stringify(out, null, 1));
    await ctx.close();
  }
  console.log("errors", errors);
  await b.close();
})();
