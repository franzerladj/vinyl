# Crate als echte App veröffentlichen

Crate ist eine installierbare Web-App (PWA). Für die Stores wird sie in eine dünne native Hülle verpackt. Der Code bleibt derselbe, Updates kommen weiter über Cloudflare, ohne neue Store-Version.

## Was schon erledigt ist

- Manifest mit App-ID, Sprache, Kategorien, Shortcuts (Scannen, Wantlist, Sets, Shoppen), normalen und maskierbaren Icons
- Icons: `icon-192.png`, `icon-512.png`, `icon-maskable-*.png`, `apple-touch-icon.png`, `icon-1024.png` (Store-Icon)
- Offline-Start über den Service Worker, Update-Hinweis statt Zwangs-Neuladen
- Fehlerseite statt weißem Bildschirm, automatisches Neuladen nach einem Update
- Offline-Hinweis oben im Bild
- Impressum (`/impressum`) und Datenschutz (`/datenschutz`), auch ohne Anmeldung erreichbar
- Keine Verbindung zu Google Fonts (Schriften liegen in der App), YouTube lädt erst nach Antippen
- Kein Tracking, keine Werbung, kein Nutzerkonto auf dem Server. Alle Daten liegen auf dem Gerät und lassen sich unter Einstellungen → Daten löschen
- Discogs-Hinweis („nutzt die Discogs-API, ist aber nicht mit Discogs verbunden …“), wie es die Discogs-API-Bedingungen verlangen
- Sicherheits-Header in `web/public/_headers`

## Vor dem Veröffentlichen

1. **Impressum ausfüllen:** `web/src/pages/Legal.tsx`, Objekt `OPERATOR`. Solange Platzhalter drinstehen, zeigen beide Seiten einen gelben Hinweis.
2. **Eigene Domain** (z. B. `crate.app` oder `crate.feuerpfeil.de`) in Cloudflare Pages verbinden und in der Discogs-App-Einstellung als Callback-URL eintragen.
3. **Discogs-App umbenennen** (developers → Settings), Beschreibung und Website setzen. Discogs begrenzt auf 60 Anfragen pro Minute und IP-Adresse. Weil die App direkt vom Handy anfragt, hat jeder Nutzer sein eigenes Kontingent.
4. **Screenshots** mit der echten Sammlung machen (iPhone 6,7" und 6,5", Android Phone). Start, Sammlung, Release mit BPM/Key, Set-Builder, Einleger-Vorschau.
5. **Datenschutz-Angaben im Store** (siehe unten) eintragen.

## Android (Google Play): Trusted Web Activity

Eine TWA ist Chrome im Vollbild ohne Adressleiste. Google akzeptiert das ausdrücklich.

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://DEINE-DOMAIN/manifest.webmanifest
bubblewrap build
```

- Paketname z. B. `de.feuerpfeil.crate`
- Bubblewrap gibt einen SHA-256-Fingerabdruck aus. Den in `web/public/.well-known/assetlinks.json` eintragen, sonst zeigt die App eine Adressleiste:

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "de.feuerpfeil.crate",
               "sha256_cert_fingerprints": ["AA:BB:..."] } }]
```

- Bei Play App Signing den Fingerabdruck aus der Play Console nehmen, nicht den lokalen.
- Kamera, Barcode-Erkennung (nativ in Chrome) und Teilen funktionieren in der TWA ohne Zusatzcode.

## iOS (App Store): Capacitor

Apple lehnt reine Website-Hüllen ab (Richtlinie 4.2). Crate bringt aber genug eigene Funktionen mit, und mit Capacitor kommen native Teile dazu:

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios
npx cap init Crate de.feuerpfeil.crate --web-dir web/dist
npx cap add ios
npx cap open ios   # in Xcode signieren und hochladen
```

Empfohlene native Ergänzungen, damit die App die Prüfung sicher besteht und sich besser anfühlt:

- `@capacitor-mlkit/barcode-scanning`: schneller nativer Barcode-Scanner (iOS Safari hat keinen eingebauten)
- `@capacitor/haptics`: echte Taptic-Engine-Rückmeldung
- `@capacitor/share`: natives Teilen-Menü für Sets
- `@capacitor/browser` oder eine zweite WebView: Discogs-Marktplatz mit dem Login des Nutzers öffnen und Angebote auslesen. Damit fällt das Lesezeichen komplett weg, weil die App die Seite selbst lesen darf.

Wichtig für iOS:

- **Login:** Die Discogs-Anmeldung muss im In-App-Browser (`@capacitor/browser`, SFSafariViewController) laufen und per Deep Link (`crate://callback`) zurückkommen. Dafür im Server eine zweite Callback-Route anlegen.
- **API-Basis:** In der nativen Hülle zeigt `server.url` in `capacitor.config.ts` auf die Domain, oder die Web-Dateien liegen lokal und die API-Aufrufe gehen an die volle Domain.
- Kamera-Text in `Info.plist`: `NSCameraUsageDescription` = „Crate liest Barcodes und Labels, um Platten zu finden.“

## Datenschutz-Angaben im Store

| Frage | Antwort |
| --- | --- |
| Tracking | Nein |
| Werbung | Nein |
| Erhobene Daten | Keine, die mit der Person verknüpft beim Anbieter gespeichert werden |
| Kamera | Nur zum Erkennen von Platten, Fotos werden nicht gespeichert |
| Konto löschen | Kein Konto beim Anbieter. Abmelden und „Alle lokalen Daten löschen“ unter Einstellungen → Daten |
| Altersfreigabe | 4+ / USK 0 (Links zu YouTube und Discogs: „Unbeschränkter Webzugriff“ angeben) |

## Kosten

- Google Play: einmalig 25 US-Dollar
- Apple Developer Program: 99 US-Dollar pro Jahr
- Cloudflare Pages und Workers: im kostenlosen Rahmen, solange Workers AI unter dem Tageskontingent bleibt
