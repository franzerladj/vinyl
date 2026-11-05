// Mithören: Chromium bekommt eine WAV-Datei als Mikrofon (Kick 124 BPM, A-Moll, Raumrauschen)
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");

function wav(file, bpm = 124, seconds = 70, rate = 48000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  const beat = (60 / bpm) * rate;
  const chord = [220, 261.63, 329.63, 440, 523.25];
  for (let i = 0; i < n; i++) {
    const t = i / rate, since = (i % beat) / rate;
    const kick = since < 0.15 ? Math.sin(2 * Math.PI * (120 + 200 * Math.exp(-since * 40)) * since) * Math.exp(-since * 18) : 0;
    const hat = ((i + beat / 2) % beat) / rate < 0.03 ? (Math.random() * 2 - 1) * 0.3 : 0;
    let pad = 0; for (const f of chord) pad += Math.sin(2 * Math.PI * f * t) / chord.length;
    const v = 0.45 * kick + 0.2 * pad + hat + 0.04 * (Math.random() * 2 - 1);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 30000))), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

(async () => {
  const file = path.join(__dirname, "listen.wav");
  if (!fs.existsSync(file)) wav(file);
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${file}`, "--autoplay-policy=no-user-gesture-required"] });
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, permissions: ["microphone"] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    await page.addInitScript(() => localStorage.setItem("crate:yt", "no"));
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.goto("http://localhost:8787/release/2");
    await page.waitForSelector("table tr", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.click(".track-tools >> text=Mithören");
    await page.waitForSelector(".listen-btn");
    await page.waitForTimeout(400);
    await page.locator(".sheet").screenshot({ path: `${__dirname}/listen-idle-${scheme}.png` });
    await page.click(".listen-btn");
    await page.waitForTimeout(13000);
    await page.locator(".sheet").screenshot({ path: `${__dirname}/listen-on-${scheme}.png` });
    await page.waitForSelector(".listen .tap-take", { timeout: 90000 });
    const text = await page.locator(".listen-info").innerText();
    await page.locator(".sheet").screenshot({ path: `${__dirname}/listen-done-${scheme}.png` });
    const secs = await page.evaluate(() => performance.now());
    await page.click(".listen .tap-take");
    await page.waitForTimeout(600);
    const saved = await page.evaluate(async () => {
      const req = indexedDB.open("crate");
      const db = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const all = await new Promise((r) => { const q = db.transaction("tracks").objectStore("tracks").getAll(); q.onsuccess = () => r(q.result); });
      return all.filter((t) => t.releaseId === 2 && t.bpmSource === "Mithören").map((t) => `${t.position} ${t.bpm} ${t.key}`);
    });
    console.log(scheme, JSON.stringify(text), "gespeichert", saved, "aktiv", await page.locator(".listen-picks .chip.on").textContent(), "errors", errors, Math.round(secs / 1000));
    await ctx.close();
  }
  await b.close();
})();
