// Tap-Tempo: 16 Tipps bei 122 BPM mit Wackeln und einem verpassten Schlag
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.goto("http://localhost:8787/release/2");
    await page.waitForSelector("table tr", { timeout: 20000 });
    // Warten, bis die Tracks Metadaten haben, dann einen anklicken
    for (let i = 0; i < 20 && !(await page.isVisible(".tap-btn")); i++) {
      await page.waitForTimeout(1000);
      await page.locator("table tr[style*='pointer']").first().click().catch(() => {});
    }
    await page.waitForSelector(".tap-btn");
    // Tipps im Browser auslösen (genaues Timing), Schlag 9 auslassen
    await page.evaluate(async () => {
      const btn = document.querySelector(".tap-btn");
      const period = 60000 / 122;
      const t0 = performance.now();
      for (let i = 0; i < 17; i++) {
        if (i === 9) continue;
        const target = t0 + i * period + (Math.random() * 2 - 1) * 20;
        while (performance.now() < target) await new Promise((r) => setTimeout(r, 1));
        btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      }
    });
    await page.waitForTimeout(250);
    const bpm = await page.locator(".tap-bpm").textContent();
    const status = await page.locator(".tap-status").textContent();
    await page.locator(".tap").screenshot({ path: `${__dirname}/tap-${scheme}.png` });
    console.log(scheme, "bpm", bpm, "status", status, "button", await page.locator(".tap-take").textContent(), "errors", errors);
    await ctx.close();
  }
  await b.close();
})();
