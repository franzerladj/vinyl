// Diggen, wenn Deezer kurz bremst: der Server antwortet auf die erste Anfrage je Hörprobe mit 503.
// Die Karte darf dann nicht „Keine Hörprobe“ zeigen, sondern fragt nach und spielt beim zweiten Versuch.
// Gegenprobe (MODE=none): gibt es wirklich keine (404), steht das ohne lange Wartezeit da.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const wav = () => {
  const n = 8000;
  const b = Buffer.alloc(44 + n, 128);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
};
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const mode of ["bremst", "keine"]) {
    const ctx = await b.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await install(page);
    const seen = new Map();
    const log = [];
    await page.route("**/api/audio/preview**", (r) => {
      const u = new URL(r.request().url());
      const warm = u.searchParams.get("warm") === "1";
      const key = `${u.searchParams.get("artist")}|${u.searchParams.get("title")}`;
      if (mode === "keine") return (log.push(warm ? "frage:404" : "ton:404"), r.fulfill({ status: 404, body: "" }));
      if (warm) return (log.push("frage:204"), r.fulfill({ status: 204, body: "" }));
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      // Erste Anfrage nach dem Ton: Deezer bremst. Danach klappt es.
      if (n === 1) return (log.push("ton:503"), r.fulfill({ status: 503, body: "" }));
      log.push("ton:200");
      return r.fulfill({ status: 200, contentType: "audio/wav", body: wav() });
    });
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.click(".dig-entry");
    await page.waitForSelector(".dig-sound", { timeout: 20000 });
    const label = () => page.evaluate(() => document.querySelector(".dig-playbtn")?.getAttribute("aria-label") ?? "-");
    const t0 = Date.now();
    let first = "";
    // bis die Karte sich entschieden hat (spielt oder „Keine Hörprobe“)
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      first = await label();
      if (/Pause|Keine|Video/.test(first)) break;
    }
    const ms = Date.now() - t0;
    await page.evaluate(() => { const f = document.querySelector(".dig-feed"); f.scrollBy({ top: f.clientHeight }); });
    await page.waitForTimeout(3500);
    out[mode] = { ersteKarte: first.slice(0, 22), entschiedenNachMs: ms, zweiteKarte: (await label()).slice(0, 22), anfragen: log.slice(0, 8).join(" "), errors };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
