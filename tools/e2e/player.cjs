// Player: Hörprobe auf der Platten-Seite starten, Seite wechseln, Leiste bleibt und spielt weiter.
// Großer Player: antippen oder hochziehen, weiter, spulen, nach unten wischen klappt ein (Ton läuft weiter).
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
    // Hörprobe: 20 Sekunden Stille als WAV (lang genug, damit der Player nicht von selbst weiterspringt)
    const wav = (() => { const n = 160000, buf = Buffer.alloc(44 + n * 2); buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(16000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40); return buf; })();
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
    // Großer Player per Antippen
    await page.click(".mp-main");
    await page.waitForSelector(".np");
    await page.waitForTimeout(700);
    const gross = { titel: await page.locator(".np-title").innerText(), marke: await page.locator(".np-label").innerText(), naechste: await page.locator(".np-row").count(), tags: await page.locator(".np-tags").innerText().catch(() => "") };
    if (out) await page.screenshot({ path: `${out}/player-gross-${scheme}.png` });
    // Weiter
    await page.click(".np-step[aria-label='Weiter']");
    await page.waitForTimeout(600);
    gross.nachWeiter = await page.locator(".np-title").innerText();
    // Spulen: in die Mitte der Leiste tippen
    const bar = await page.locator(".np-bar").boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
    await page.waitForTimeout(500);
    gross.stelle = await page.locator(".np-times span").first().innerText();
    // Nach unten wischen klappt ein, die Leiste bleibt
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", 195, 200);
    for (let i = 1; i <= 8; i++) await touch("touchMove", 195, 200 + i * 35);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(600);
    gross.eingeklappt = !(await page.$(".np")) && (await page.isVisible(".mini-player"));
    // Hochziehen öffnet wieder
    const mp = await page.locator(".mini-player").boundingBox();
    await touch("touchStart", mp.x + 120, mp.y + 30);
    for (let i = 1; i <= 6; i++) await touch("touchMove", mp.x + 120, mp.y + 30 - i * 14);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(600);
    gross.hochgezogen = Boolean(await page.$(".np"));
    // Zurück (Android-Taste) klappt ein
    await page.goBack();
    await page.waitForTimeout(500);
    gross.zurueck = !(await page.$(".np")) && page.url().endsWith("/sets");
    console.log(scheme, "groß", JSON.stringify(gross));
    await page.click(".mp-btn[aria-label='Wiedergabe beenden']");
    await page.waitForTimeout(400);
    console.log(scheme, { auf, bleibt, titel, weg: !(await page.isVisible(".mini-player")), errors });
  }
  await b.close();
})();
