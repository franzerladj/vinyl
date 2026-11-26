// Chrome-Erweiterung im echten Chromium: Feld auf einer (nachgestellten) Discogs-Plattenseite, Wantlist umschalten,
// Einblendung „In Crate nachsehen“, Suchfenster, Zahl am Symbol, abgemeldet. Braucht keinen Crate-Server:
// tools/ext/mock.cjs spielt Crate und Discogs. Aufruf: node tools/e2e/ext.cjs [bildordner]
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const OUT = process.argv[2] || __dirname;
const B = "http://localhost:8799";
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crate-ext-"));
  const ext = path.join(dir, "ext");
  execFileSync("node", [path.join(__dirname, "..", "ext", "build.cjs"), ext, B]);
  const mock = spawn("node", [path.join(__dirname, "..", "ext", "mock.cjs")], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 700));
  const ctx = await chromium.launchPersistentContext(path.join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const out = {};
  const errors = [];
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
    out.id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));

    // Abgemeldet: das Feld sagt, was zu tun ist
    await page.goto(`${B}/release/3-Larry-Heard-Bar-A-Thym`);
    await page.waitForSelector("#crate-panel .note");
    out.abgemeldet = await page.locator("#crate-panel .note").first().innerText();

    // Angemeldet (Cookie der Crate-Seite): Platte aus der Sammlung
    await page.goto(`${B}/login`);
    await page.goto(`${B}/release/3-Larry-Heard-Bar-A-Thym`);
    await page.waitForSelector("#crate-panel .verdict");
    out.urteil = await page.locator("#crate-panel .verdict").innerText();
    out.angaben = (await page.locator("#crate-panel .facts").innerText()).replace(/\n/g, " | ");
    out.tracks = await page.locator("#crate-panel .tr").allInnerTexts().then((t) => t.map((x) => x.replace(/\n/g, " ")));
    out.sets = await page.locator("#crate-panel .note").last().innerText();
    await page.screenshot({ path: `${OUT}/ext-sammlung.png` });
    // Einklappen merkt sich die Erweiterung
    await page.locator("#crate-panel .ic").click();
    out.eingeklappt = await page.locator("#crate-panel .verdict").isHidden();
    await page.locator("#crate-panel .ic").click();

    // Platte von der Wantlist: herunternehmen, dann „Neu für dich“ mit Preis
    await page.goto(`${B}/release/46-Patrice-Scott-Falling-Up`);
    await page.waitForSelector("#crate-panel .verdict");
    out.want = await page.locator("#crate-panel .verdict").innerText();
    await page.locator("#crate-panel .btn", { hasText: "Von der Wantlist nehmen" }).click();
    await page.waitForSelector("#crate-panel .verdict.new");
    out.nachHerunternehmen = (await page.locator("#crate-panel .verdict").innerText()).replace(/\n/g, " | ");
    await page.screenshot({ path: `${OUT}/ext-neu.png` });

    // Rechtsklick → „In Crate nachsehen“ auf einer fremden Seite (das Menü selbst lässt sich hier nicht bedienen,
    // der Test ruft denselben Weg auf, den der Menüeintrag nimmt)
    await page.goto(`${B}/shop`);
    await sw.evaluate(async (q) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      await self.crateLook(tab.id, q);
    }, "Delano Smith The Bells");
    await page.waitForSelector("#crate-overlay .row");
    out.einblendung = await page.locator("#crate-overlay .row").allInnerTexts().then((t) => t.map((x) => x.replace(/\n/g, " | ")));
    await page.locator("#crate-overlay .mini", { hasText: "Auf die Wantlist" }).first().click();
    await page.waitForSelector("#crate-overlay .chip.want");
    out.einblendungNachWant = await page.locator("#crate-overlay .chip").first().innerText();
    await page.screenshot({ path: `${OUT}/ext-einblendung.png` });
    await page.keyboard.press("Escape");
    out.einblendungZu = (await page.locator("#crate-overlay").count()) === 0;

    // Suchfenster am Symbol
    const pop = await ctx.newPage();
    pop.on("pageerror", (e) => errors.push(e.message));
    await pop.setViewportSize({ width: 400, height: 600 });
    await pop.goto(`chrome-extension://${out.id}/popup.html`);
    await pop.waitForSelector(".status:not(:empty)");
    out.status = await pop.locator(".status").innerText();
    await pop.fill("input", "TRA103");
    await pop.keyboard.press("Enter");
    await pop.waitForSelector(".row");
    out.suche = await pop.locator(".row").allInnerTexts().then((t) => t.map((x) => x.replace(/\n/g, " | ")));
    await pop.screenshot({ path: `${OUT}/ext-suche.png` });
    await pop.fill("input", "nichts dergleichen");
    await pop.keyboard.press("Enter");
    await pop.waitForSelector(".empty");
    out.leer = await pop.locator(".empty").innerText();

    // Zahl am Symbol und was beim Server ankam
    out.zahl = await sw.evaluate(() => chrome.action.getBadgeText({}));
    const st = await (await fetch(`${B}/state`)).json();
    out.wantlist = st.wants;
    out.schreibend = st.calls.filter((c) => /^(PUT|DELETE)/.test(c));
    const last = st.sign[st.sign.length - 1];
    out.anfrageKopf = { origin: last.origin, secFetchSite: last.site, cookie: last.cookie };
    // Sparsam mit der Schnittstelle: wie viele Discogs-Anfragen hat das alles gebraucht?
    out.discogsAnfragen = st.calls.length;
  } finally {
    console.log(JSON.stringify(out, null, 1), errors);
    await ctx.close();
    mock.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
