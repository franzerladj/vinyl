// Mitteilungen in der Android-App ohne Chrome (ab App 1.9): der Schalter holt beim Server ein Kennwort,
// reicht es über crate://push an die App und wartet, bis die App sich gemeldet hat.
// Die App wird hier nachgestellt: der Stand-Abruf antwortet nach zwei Anfragen so, als hätte sie abgeholt.
//   erlaubt:   Schalter geht an, ganz ohne die Erlaubnis des Browsers (die steht hier auf „gesperrt“)
//   abgelehnt: Blatt mit Knopf „In Android erlauben“
//   alteApp:   App 1.8 mit gesperrter Browser-Erlaubnis: Blatt bietet die neue Version an
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const mode of ["erlaubt", "abgelehnt", "alteApp"]) {
    const ctx = await b.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const calls = [];
    const intents = [];
    // Der Sprung in die App ist im Testbrowser eine Anfrage an intent://…, die ins Leere geht
    page.on("request", (r) => r.url().startsWith("intent://") && intents.push(r.url()));
    await install(page);
    let statusCalls = 0;
    const token = "ab".repeat(32);
    await page.route("**/api/push/**", (r) => {
      const p = new URL(r.request().url()).pathname.replace("/api/push/", "");
      calls.push(p);
      const json = (o) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
      if (p === "native/start") return json({ token, prefs: { friends: true, wants: true, lent: true, sets: true, sellers: true } });
      if (p === "native/status") return json(++statusCalls < 2 ? { known: true, linked: false, ok: false } : { known: true, linked: true, ok: mode === "erlaubt" });
      if (p === "status") return json({ available: true, devices: 0, prefs: null });
      return json({ ok: true });
    });
    await page.addInitScript((m) => {
      localStorage.setItem("crate:app", JSON.stringify({ android: true, v: m === "alteApp" ? 9 : 10 }));
      // Chrome meldet „gesperrt“: darf in der neuen App keine Rolle spielen
      Object.defineProperty(Notification, "permission", { get: () => "denied" });
      Notification.requestPermission = async () => "denied";
    }, mode);
    await page.goto(B + "/settings");
    await page.waitForSelector(".set-row:has-text('Mitteilungen') .switch", { timeout: 30000 });
    await page.click(".set-row:has-text('Mitteilungen') .switch");
    await page.waitForTimeout(mode === "alteApp" ? 1200 : 4200);
    const sw = page.locator(".set-row:has-text('Mitteilungen') .switch input, .set-row:has-text('Mitteilungen') .switch").first();
    out[mode] = {
      start: calls.includes("native/start"),
      browserAbo: calls.includes("subscribe"),
      appGerufen: intents.some((i) => i.includes(`push?t=${token}`)),
      an: await page.evaluate(() => new Promise((res) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const g = q.result.transaction("kv").objectStore("kv").get("pushOn"); g.onsuccess = () => res(Boolean(g.result?.value)); }; })),
      schalter: await sw.getAttribute("aria-checked").catch(() => null),
      blatt: await page.locator(".push-help-title").isVisible().catch(() => false),
      knopfAndroid: await page.locator("button:has-text('In Android erlauben')").isVisible().catch(() => false),
      neueVersion: await page.locator(".push-help a:has-text('laden')").isVisible().catch(() => false),
      toast: await page.locator(".toast").first().textContent().catch(() => "-"),
      errors,
    };
    await page.screenshot({ path: `${__dirname}/nativepush-${mode}.png` });
    if (mode === "erlaubt") {
      // Ausschalten meldet das Gerät ab
      await page.click(".set-row:has-text('Mitteilungen') .switch");
      await page.waitForTimeout(1000);
      out[mode].abgemeldet = calls.includes("native/stop");
    }
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
