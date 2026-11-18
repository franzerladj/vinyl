// Diggen: Hörprobe läuft von selbst, ohne dass man sie auf jeder Karte antippen muss
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
// Eine Sekunde Stille als WAV, statt der 404 aus dem Mock
const wav = () => {
  const n = 8000;
  const b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  await page.route("**/api/audio/preview**", (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: wav() }));
  await page.goto("http://localhost:8787/");
  await page.waitForSelector("text=45 Platten");
  await page.click(".dig-entry"); // die einzige Berührung
  await page.waitForSelector(".dig-card .dig-deck, .dig-card img", { timeout: 20000 });
  const label = () => page.evaluate(() => document.querySelector(".dig-playbtn")?.getAttribute("aria-label") ?? "-");
  await page.waitForTimeout(2500);
  const first = await label();
  await page.evaluate(() => { const f = document.querySelector(".dig-feed"); f.scrollBy({ top: f.clientHeight }); });
  await page.waitForTimeout(2500);
  const second = await label();
  console.log({ first: first.slice(0, 20), second: second.slice(0, 20), errors });
  await b.close();
})();
