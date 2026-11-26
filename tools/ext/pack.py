# Erweiterung zum Laden packen: web/public/download/crate-erweiterung.zip (Ordner „crate-erweiterung“ darin)
# und crate-erweiterung.json mit Version und Prüfsumme der Quellen. Aufruf: python3 tools/ext/pack.py
# Nach jeder Änderung unter extension/ neu ausführen, sonst schlägt tests/ext.test.ts fehl.
import hashlib, json, os, zipfile

root = os.path.join(os.path.dirname(__file__), "..", "..")
src = os.path.join(root, "extension")
out = os.path.join(root, "web", "public", "download")
files = sorted(os.path.relpath(os.path.join(d, f), src) for d, _, fs in os.walk(src) for f in fs)
h = hashlib.sha256()
for f in files:
    h.update(f.replace(os.sep, "/").encode())
    h.update(open(os.path.join(src, f), "rb").read())
version = json.load(open(os.path.join(src, "manifest.json")))["version"]
with zipfile.ZipFile(os.path.join(out, "crate-erweiterung.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        # Feste Zeit: gleiche Quellen ergeben dieselbe Datei
        info = zipfile.ZipInfo("crate-erweiterung/" + f.replace(os.sep, "/"), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, open(os.path.join(src, f), "rb").read())
json.dump({"version": version, "sha": h.hexdigest()}, open(os.path.join(out, "crate-erweiterung.json"), "w"))
print(version, h.hexdigest()[:12], len(files), "Dateien")
