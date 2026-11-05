// Logo „Die Kiste“: Plattenkiste mit gezogener Platte. Erzeugt alle Icons aus einer Quelle.
// node tools/brand/logo.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const INK = "#16120f";
const ORANGE = "#ff5b14";
const ART = `
  <g transform="rotate(-11 200 220)"><rect x="104" y="112" width="196" height="196" rx="6" fill="#e9dfcc"/></g>
  <g transform="rotate(9 320 220)"><rect x="214" y="104" width="196" height="196" rx="6" fill="#c9b99c"/></g>
  <circle cx="256" cy="196" r="118" fill="#0b0908"/>
  <g fill="none" stroke="#2b2420" stroke-width="3"><circle cx="256" cy="196" r="104"/><circle cx="256" cy="196" r="90"/><circle cx="256" cy="196" r="76"/><circle cx="256" cy="196" r="62"/></g>
  <circle cx="256" cy="196" r="40" fill="${ORANGE}"/>
  <circle cx="256" cy="196" r="7" fill="#0b0908"/>
  <rect x="72" y="262" width="368" height="178" rx="30" fill="${ORANGE}"/>
  <rect x="72" y="262" width="368" height="22" rx="11" fill="#ff7a3a"/>
  <rect x="196" y="306" width="120" height="38" rx="19" fill="${INK}"/>
  <rect x="104" y="384" width="304" height="8" rx="4" fill="#d9470b"/>`;

const svg = (body, { rx = 112, scale = 1 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="${INK}"/><g transform="translate(256 259) scale(${scale}) translate(-256 -259)">${body}</g></svg>`;

// Mitteilungs-Badge: nur die Form zählt (Android nutzt den Alphakanal)
const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 259) scale(0.92) translate(-256 -259)" fill="#fff">
  <path fill-rule="evenodd" d="M256 78a118 118 0 1 1 0 236a118 118 0 1 1 0-236zm0 78a40 40 0 1 0 0 80a40 40 0 1 0 0-80z"/>
  <path fill-rule="evenodd" d="M102 262h308a30 30 0 0 1 30 30v118a30 30 0 0 1-30 30H102a30 30 0 0 1-30-30V292a30 30 0 0 1 30-30zm113 44a19 19 0 0 0 0 38h82a19 19 0 0 0 0-38z"/></g></svg>`;

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
