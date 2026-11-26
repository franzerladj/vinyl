// Erweiterung für den Browser-Test bauen: Kopie von extension/ mit anderen Adressen (nachgestellter Server).
// Aufruf: node tools/ext/build.cjs <zielordner> [crate-adresse] [discogs-seite]
// Ohne Adressen entsteht eine unveränderte Kopie (zum Verteilen als Ordner oder ZIP).
const fs = require("fs");
const path = require("path");
const [out, crate, site] = process.argv.slice(2);
if (!out) throw new Error("Zielordner fehlt");
const src = path.join(__dirname, "..", "..", "extension");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
if (crate) {
  const discogs = site || crate;
  fs.writeFileSync(path.join(out, "config.js"), `export const CRATE = ${JSON.stringify(crate)};\nexport const DISCOGS_SITE = ${JSON.stringify(discogs)};\n`);
  const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  m.host_permissions = [...new Set([crate, discogs])].map((o) => `${o}/*`);
  m.content_scripts[0].matches = [`${discogs}/*`];
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(m, null, 2));
}
console.log(out);
