// Logo „C mit Rillen“: ein C aus zwei Plattenrillen mit Mittelloch. Erzeugt alle Icons aus einer Quelle.
// node tools/brand/logo.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const INK = "#0b0b0b";
const LIME = "#c6ff3a";
const PAPER = "#f5f5f4";
// Logo „C mit Rillen“: zwei Rillen bilden ein C, in der Mitte das Loch der Platte
const RINGS = (c) => `<path d="M372 140A164 164 0 1 0 372 372" fill="none" stroke="${c}" stroke-width="44" stroke-linecap="round"/><path d="M323 189A95 95 0 1 0 323 323" fill="none" stroke="${c}" stroke-width="44" stroke-linecap="round"/>`;
const ART = `${RINGS(LIME)}<circle cx="256" cy="256" r="24" fill="${PAPER}"/>`;

const svg = (body, { rx = 112, scale = 1 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="${INK}"/><g transform="translate(256 256) scale(${scale * 0.86}) translate(-256 -256)">${body}</g></svg>`;

// Mitteilungs-Badge: nur die Form zählt (Android nutzt den Alphakanal)
const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(0.96) translate(-256 -256)">${RINGS("#fff")}<circle cx="256" cy="256" r="26" fill="#fff"/></g></svg>`;

const pub = path.join(__dirname, "../../web/public");
const files = {
  "icon.svg": svg(ART),
  "icon-maskable.svg": svg(ART, { rx: 0, scale: 0.74 }),
};
for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(pub, f), s + "\n");

const png = [
  ["icon-192.png", svg(ART), 192, true],
  ["icon-512.png", svg(ART), 512, true],
  ["icon-1024.png", svg(ART, { rx: 0, scale: 0.86 }), 1024, false],
  ["apple-touch-icon.png", svg(ART, { rx: 0, scale: 0.86 }), 180, false],
  ["icon-maskable-192.png", files["icon-maskable.svg"], 192, false],
  ["icon-maskable-512.png", files["icon-maskable.svg"], 512, false],
  ["badge-96.png", BADGE, 96, true],
];

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  for (const [f, s, size, transparent] of png) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${s.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(pub, f), omitBackground: transparent });
  }
  await b.close();
  console.log("Icons geschrieben:", [...Object.keys(files), ...png.map((p) => p[0])].join(", "));
})();
