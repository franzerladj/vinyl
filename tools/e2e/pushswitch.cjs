// Mitteilungen im Browser und in älteren Android-Apps: ein Schalter. Erlaubt = an (mit Probe), gesperrt = Blatt (ältere App: neue Version laden),
// erlaubt nach dem Zurückkommen = schaltet selbst ein.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const mode of ["erlaubt", "gesperrt", "zurueck"]) {
    const ctx = await b.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const calls = [];
    page.on("request", (r) => r.url().includes("/api/push/") && calls.push(r.url().split("/api/push/")[1]));
    await install(page);
    // Android-App 1.5 simulieren, Erlaubnis je nach Fall
    await page.addInitScript((m) => {
      localStorage.setItem("crate:app", JSON.stringify({ android: true, v: 6 }));
      let perm = m === "gesperrt" ? "denied" : m === "zurueck" ? "granted" : "default";
      Object.defineProperty(Notification, "permission", { get: () => perm });
      Notification.requestPermission = async () => (perm = m === "gesperrt" ? "denied" : "granted");
      const sub = { endpoint: "https://fcm.googleapis.com/x", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } }), unsubscribe: async () => true };
      // Push-Dienst gibt es im Testbrowser nicht: Abo vortäuschen
      PushManager.prototype.getSubscription = async () => (window.__sub ? sub : null);
      PushManager.prototype.subscribe = async () => ((window.__sub = true), sub);
    }, mode);
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    if (mode === "zurueck") {
      // Gewünscht, aber noch nicht an: Wunsch setzen, dann „zurückkommen“
      await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("crate"); q.onsuccess = () => { const tx = q.result.transaction("kv", "readwrite"); tx.objectStore("kv").put({ key: "pushWanted", value: true }); tx.oncomplete = r; }; }));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForTimeout(2500);
      out[mode] = { an: calls.includes("subscribe"), probe: calls.includes("test"), toast: await page.locator(".toast").first().textContent().catch(() => "-"), errors };
    } else {
      await page.goto(B + "/settings");
      await page.waitForSelector(".set-row:has-text('Mitteilungen') .switch");
      await page.click(".set-row:has-text('Mitteilungen') .switch");
      await page.waitForTimeout(1500);
      out[mode] = {
        an: calls.includes("subscribe"),
        probe: calls.includes("test"),
        blatt: await page.locator(".push-help-title").isVisible().catch(() => false),
        // Ältere Android-Apps bekommen statt eines Umwegs über Chrome die neue Version angeboten (siehe nativepush.cjs)
        neueVersion: await page.locator(".push-help a:has-text('laden')").isVisible().catch(() => false),
        errors,
      };
      if (mode === "gesperrt") await page.screenshot({ path: `${__dirname}/push-gesperrt.png` });
    }
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
