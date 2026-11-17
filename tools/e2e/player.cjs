// Mini-Player: Hörprobe auf der Platten-Seite starten, Seite wechseln, Leiste bleibt und spielt weiter
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const B = "http://localhost:8787";
const out = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  for (const scheme of ["light", "dark"]) {
    const page = await (await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    // Hörprobe: eine Sekunde Stille als WAV
    const wav = (() => { const n = 8000, buf = Buffer.alloc(44 + n * 2); buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40); return buf; })();
    await page.route("**/api/audio/preview**", (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: wav }));
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto(B + "/");
    await page.waitForSelector("text=45 Platten", { timeout: 30000 });
    await page.goto(B + "/release/4");
    await page.waitForSelector("tr td.pos");
    // Track ohne Video: Release 4 hat ein Video für den ersten Track, also einen späteren nehmen
    await page.locator("tr:has(td.pos)").nth(1).click();
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const auf = await page.isVisible(".mini-player");
    await page.click(".nav >> text=Sets");
    await page.waitForTimeout(900);
    const bleibt = await page.isVisible(".mini-player");
    const titel = await page.locator(".mp-text b").innerText().catch(() => "-");
    if (out) await page.screenshot({ path: `${out}/player-${scheme}.png` });
    await page.click(".mp-btn[aria-label='Wiedergabe beenden']");
    await page.waitForTimeout(400);
    console.log(scheme, { auf, bleibt, titel, weg: !(await page.isVisible(".mini-player")), errors });
  }
  await b.close();
})();
