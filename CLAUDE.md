# Crate – Projektnotizen für Claude

Mobile Web-App (PWA) für Vinyl-DJs auf Basis von Discogs. Besitzer: Franz Kralik (Feuerpfeil, Bayreuth).

## Arbeitsweise

- Mit Franz auf **Deutsch** schreiben. **Keine Gedankenstriche (—)**, keine Buzzwords, kein „Game-Changer“. Gilt auch für Texte in der App.
- Branch: `claude/discogs-vinyl-dj-app-yao8n6`. Kein Pull Request ohne ausdrücklichen Wunsch.
- Commit-Nachrichten auf Deutsch, beschreibend. Keine Modellnamen in Commits oder Code.
- Nie Secrets committen oder Franz bitten, Schlüssel in den Chat zu kopieren.
- Nicht anfassen: das alte Cloudflare-Projekt `vinyl-wantlist`.
- Marke: Logo „Die Kiste“ (Plattenkiste mit gezogener Platte), Quelle `tools/brand/logo.cjs` (erzeugt alle Icons), Komponente `web/src/components/Logo.tsx`. Farben Orange `#ff5b14`, Tinte `#16120f`, Papier `#e9dfcc`. Flächen warm statt Apple-Grau: dunkel auf Tinte (`--bg #16120f`), hell auf Papier (`--bg #efe8dc`, Karten `#fffdf8`). Platten-Seite: Tonarm (`ToneArm` in `Release.tsx`) schwenkt beim Abspielen ein, kein Weichzeichner-Hintergrund. Große Titel in Archivo schmal (wdth 62, 900, Versalien), Katalognummern/Matrix/Zustand in JetBrains Mono.
- Darf nicht nach KI aussehen: keine Farbverläufe, kein Leuchten, keine Weichzeichner-Wolken, kein Funkel-Symbol, keine Wörter wie „KI“ oder „analysieren“ in der Oberfläche. Lieber Begriffe aus dem Plattenladen (Kiste, Pressung, Zustand, Seite A/B).
- Startbildschirm: steht als HTML/CSS direkt in `web/index.html` (`#splash`, erscheint vor dem JavaScript), `main.tsx` blendet ihn nach 1,4 s aus (in derselben Sitzung nach 0,3 s), Schriftzug erst wenn die Markenschrift geladen ist. Im Inline-CSS keine `font`-Kurzform mit Prozent-Breite (der Minifier macht sie ungültig).
- Animationen nur über `transform`/`opacity` (120 Hz): keine Übergänge auf width/height/left/box-shadow/filter, Skeleton pulsiert über Deckkraft, Seitenwechsel dunkelt über Deckkraft ab. Der kleine Titel der Werkzeugleiste gleicht seine Höhe mit negativem Abstand aus (kein Springen).
- UI-Anspruch: wirkt wie eine große native iOS-App (Apple-Design, Motion, Haptik). Änderungen immer im Handy-Viewport (Playwright, „iPhone 13“) prüfen, hell und dunkel, und mit `tools/e2e/wrap.cjs` auf 320 px gegenprüfen.
- Umbrüche: Silbentrennung nur in Fließtext, nie in Labels, Fragen, Titeln oder Knöpfen. Kurze Labels statt Trennung. Klammern in Titeln brechen als Ganzes um (`keepParens` in `bits.tsx`, Klasse `.nobr`; auf Teilen-Karten in `wrap()`), Klammern über 40 Zeichen dürfen brechen.

## Aufbau

- `web/`: Vite + React 19 + TypeScript, PWA (`vite-plugin-pwa`, Update per Hinweis). Data-Router (`createBrowserRouter`) wegen View Transitions. Daten lokal in IndexedDB (Dexie, `web/src/lib/db.ts`).
- `server/`: Hono-App (`server/app.ts`), läuft als Cloudflare Pages Function (`functions/api/[[path]].ts`) und lokal auf Node (`server/index.ts`).
- `shared/`: reine Logik ohne Browser/Netz (Optimizer, Setlist, Camelot, Vibes, Audioanalyse, Dig-Feed). Hier testen.
- `tests/`: Vitest. `tools/e2e/`: Browser-Tests mit gemockter Discogs-API.
- `docs/app-store.md`: Weg in Play Store (TWA) und App Store (Capacitor). `docs/plan-digging-feed.md`: Feed-Plan und Stand.

Wichtige Eigenheiten:
- Discogs-Anfragen gehen direkt vom Browser an api.discogs.com (Signatur über `/api/sign`), weil Discogs pro IP limitiert (60/min) und Cloudflare-IPs geteilt sind. Warteschlange in `web/src/lib/api.ts`.
- Auch der Login läuft vom Gerät (`web/src/lib/auth.ts`, Server: `/api/auth/start|pending|sign-access|finish|identity`). OAuth-Parameter stehen in Query/Formular statt im Header, weil Discogs bei `/oauth/*` die CORS-Vorabprüfung ablehnt. Rückfall: `/api/auth/login` und `/api/auth/exchange` (Server, mit Wiederholungen). Vorschau-Deployments haben keine Discogs-Secrets, Login nur auf Produktion testbar (`node tools/e2e/login.cjs`).
- Freunde finden: Discogs hat keine Personensuche. Freiwilliges Crate-Verzeichnis im KV (`dir:<name>`, `dirn:<namensteil>:<name>`, Routen `/api/dir/*`), dazu exakter Discogs-Name live und Lieblingshändler (`searchPeople` in `web/src/lib/friends.ts`).
- Crate-Profil (DJ-Name, Bio, Ort, bis 5 Links, 6 Styles, Platte des Moments, Setup als Rider mit `GEAR`-Plätzen und Spielweise `plays`, Vorschläge per `<datalist>`): `shared/profile.ts` (Prüfung, Link-Erkennung), KV `prof:<name>`, Routen `/api/profile/me|:u` (nur angemeldet), Karte `web/src/components/ProfileCard.tsx`, Editor unter `/settings/profile`.
- Textsuche überall über `shared/textSearch.ts` (`matchesQuery`): Satzzeichen/Klammern egal, & = and, Akzente egal. Keine `toLowerCase().includes()`-Suchen mehr bauen.
- Marktplatz-Seiten von Discogs sind für Server gesperrt (403). Angebote kommen über Inventare der Lieblingshändler (API) oder optional das Lesezeichen.
- BPM: Deezer-Album-Matching (`server/audio.ts`, `POST /api/audio/release`, Artist wird getrennt geprüft), dann Einzelsuche, dann Analyse der Hörprobe im Web Worker (`shared/audioAnalysis.ts`, Bassdrum-Band + Kammfilter, Style als Tempo-Hinweis). Gemessen an echten Hörproben: rund 95 % richtig. Keys: nur Analyse (Schätzung) oder GetSongBPM. AcousticBrainz liefert für typische Platten nichts.
- Hörproben laufen über den Server (`/api/audio/preview`). iOS: Ton nur nach Tippen, deshalb ein einziges Audio-Element wiederverwenden.
- Schriften selbst gehostet (`@fontsource-variable/*`), YouTube erst nach Antippen (DSGVO). Die Frage „Videos künftig gleich laden?“ kommt beim ersten angetippten Video (`VideoFacade` in `Release.tsx`), nicht beim Start.
- Führung: Begrüßung in vier Schritten nach dem ersten Login (`web/src/components/Welcome.tsx`, localStorage `crate:welcome:<name>`), Einmal-Hinweise mit `<Hint id>` (localStorage `crate:hint:<id>`). Browser-Tests überspringen die Begrüßung, außer `WELCOME=1` (`tools/e2e/welcome.cjs`).
- Sets teilen: das ganze Set steckt im Link (`/sets/shared#…`, `shared/setShare.ts`), nichts auf dem Server. Empfänger sieht, welche Platten er hat, und übernimmt die spielbaren Tracks. Nach dem Login führt `crate:after` (sessionStorage) zum Link zurück.
- Kisten-Vorlagen: KV `crateTemplates` (`web/src/lib/crateTemplates.ts`). Set-Verlauf: `web/src/lib/setHistory.ts`. Cue-Punkte: `TrackMeta.cueIn/cueOut`.
- Teilen-Karten (Story 1080×1920): `web/src/lib/shareCard.ts`, Discogs-Bilder über `/api/img` (CORS).
- Vinylhead-Daten (`shared/vinyl.ts`): Zustand nach Goldmine aus den Discogs-Sammlungsfeldern 1 (Platte), 2 (Hülle), 3 (Notiz), Schreiben per `setCondition` in `sync.ts`. Pressung (Matrix/Runout, Schnitt, Presswerk) aus `identifiers`/`companies` des Releases, ältere Einträge werden beim Öffnen still nachgeladen.
- Plattenbörse: nach dem Suchen auf `/scan` zeigt `Verdict` groß „Hast du schon“, „Auf deiner Wantlist“, „Andere Pressung“ (gleicher Master) oder „Neu für dich“ mit Discogs-Preis.
- Label-Vollständigkeit: `shared/labels.ts` (`labelCompletion`, je Katalognummer auf Vinyl, andere Pressung zählt), `web/src/lib/labels.ts` (`/labels/{id}/releases`, max. 5 Seiten, KV `label:<id>` 7 Tage), Seiten `/labels` und `/label/:id`, Link vom Label auf der Platten-Seite.
- Nadel-Stunden: `shared/stylus.ts` (gespielte Sets seit Einbau, Länge aus Track-Laufzeiten, sonst 6 Min. je Track, plus eigene Minuten), `web/src/lib/stylus.ts` (KV `stylus`), Seite `/settings/stylus`, Erinnerung auf Start ab 90 % der Herstellerangabe. Keine erfundenen Lebensdauern, die trägt man selbst ein.
- Digging „Mag ich“: getrennt von der Wantlist, Aktion `like`/`unlike` in `shared/dig.ts` (+2,5, Wantlist +3, Weg −2), Liste KV `digLiked` (`likedCards`/`setLiked` in `web/src/lib/dig.ts`). Nach rechts wischen oder Doppeltippen = Mag ich, nach links = Weg. Daumen-Knopf oben öffnet die Liste.
- Jahresrückblick: `shared/year.ts` (`yearReview`: Neuzugänge, Labels, Styles, gespielte Sets, Stunden, meistgespielt), Seite `/year` (`YearPage.tsx`, im Januar das Vorjahr), Story-Karte `renderYearCard` (Nullen fallen weg, ohne Sets „Neu in der Kiste“). Auf Start von November bis Januar verlinkt.
- Repress-Alarm: `shared/repress.ts` (`newPressings`: beim ersten Blick nur Vinyl aus diesem/letztem Jahr, danach unbekannte), `web/src/lib/repress.ts` (`/masters/{id}/versions`, je Master höchstens wöchentlich, 15 pro Durchlauf, KV `repressSeen`/`repressNews`), Schritt „Neue Pressungen“ im `autoPipeline`, Hinweis-Karte und Abzeichen auf der Wantlist, Mitteilung über `localNotify("wants")`.
- Sammlungswert (`shared/value.ts`, `web/src/lib/value.ts`): Gesamtwert direkt von Discogs (`/users/{u}/collection/value`, Min/Median/Max aus Verkäufen, eine Anfrage, KV `collValue`, alle 12 h). Einzelwert je Platte: Preisempfehlung für den eigenen Zustand, sonst VG+, sonst günstigstes Angebot. Blatt und Sortierung „Wert“ in `Collection.tsx`.
- Mithören (`shared/listen.ts`, `web/src/lib/listen.ts`, `web/src/components/Listen.tsx`): Mikrofon ohne Sprachfilter, alle 4 s Auswertung der letzten 60 s im Worker, sicher erst bei drei gleichen Ergebnissen (ab 30 s). Nichts verlässt das Gerät. Braucht `microphone=(self)` in `web/public/_headers`. YouTube-Ton direkt abgreifen geht nicht (Player gesperrt, Download gegen die YouTube-Bedingungen). Lange Aufnahmen werden über 8/16/32 Schläge nachgemessen (±0,1 BPM).
- Sicherheit (Audit run-1, Regressionstests in `tests/security.test.ts`): Middleware in `server/app.ts` lehnt schreibende `/api`-Anfragen von fremden Seiten ab (`crossSite`: Sec-Fetch-Site/Origin), KI nur mit bestätigter Sitzung oder eigenem `sk-ant-`-Key (`aiAccess`), `/api/audio/*` und `/api/lastfm/*` nur angemeldet, Signier-Pfade über `allowedPath` (keine Punkt-Segmente, kein `%2F`/`%2E`/Backslash). Kontowechsel: `web/src/lib/account.ts` (`claimDevice`, KV `owner`) leert beim Wechsel alle Tabellen außer `releases`, den eigenen Key und das Push-Abo. Abmelden schaltet Mitteilungen aus. Sitzungen tragen `iat`, laufen nach 180 Tagen ohne Nutzung ab und werden über `/api/me` gleitend verlängert. CSP nur frame-ancestors/base-uri/object-src/form-action (Script-Regeln würden Tesseract und Kamera ungetestet gefährden). Offen: serverseitiger Widerruf einzelner Sitzungen.
- Tap-Tempo (`shared/tap.ts`): Regression über alle Tipps, erkennt Abdriften. Der Ring blinkt erst nach dem Tippen, sonst folgt man dem Blinken statt der Musik.
- Push-Mitteilungen: `server/push.ts` (VAPID + aes128gcm selbst gebaut, getestet in `tests/push.test.ts`), Routen `/api/push/*` in `server/app.ts`, Client `web/src/lib/push.ts`, Service Worker `web/public/push-sw.js` (per `importScripts`). Speicher: KV-Binding `PUSH` (Namespace `crate-push`). Zeitplan: Worker `crate-cron` (`workers/cron/`, alle 10 Minuten; holt `/api/push/users` und ruft pro Nutzer `/api/push/run?u=` mit `X-Cron-Secret`, je eigener Aufruf mit ~45 Unteranfragen). Wants ohne Angebot oder mit Wunschpreis werden bevorzugt geprüft (`pickWants`), KV nur bei Änderungen beschreiben (Schreib-Kontingent). Öffentlicher VAPID-Schlüssel in `shared/pushKey.ts`, privater als Secret `VAPID_PRIVATE_JWK`. Server-Daten nur für Nutzer mit eingeschalteten Mitteilungen, beim Ausschalten gelöscht. iPhone: nur als Home-Bildschirm-App.

## Befehle

```bash
npm run typecheck && npm test && npm run build
# Lokaler Server mit gebauter App auf :8787
SESSION_SECRET=testtesttesttesttesttesttesttest NODE_ENV=production npx tsx server/index.ts
# Browser-Tests (Server muss laufen; Chromium/Playwright sind vorinstalliert)
node tools/e2e/nav.cjs      # Scroll-Merker, Zurück, 404
node tools/e2e/pipe.cjs     # Sync-Pipeline
node tools/e2e/dig.cjs      # Digging-Feed
python3 tools/e2e/ean.py 5021392033112 tools/e2e/ean.jpg && node tools/e2e/scan.cjs   # Barcode aus Foto
node tools/e2e/print.cjs    # Einleger als PDF
node tools/e2e/yt.cjs       # YouTube-Einwilligung
node tools/e2e/djo.cjs      # DJ-Übersicht auf Start
node tools/e2e/hero.cjs     # Kopf der Startseite zu verschiedenen Uhrzeiten
node tools/e2e/ship.cjs     # Versand-Schätzung
node tools/e2e/tap.cjs      # Tap-Tempo
node tools/e2e/push.cjs     # Mitteilungen-Seite und Freund-Rückmeldung
node tools/e2e/people.cjs   # Freunde suchen mit Vorschlägen
node tools/e2e/profile.cjs  # Crate-Profil samt Setup bearbeiten und beim Freund ansehen
node tools/e2e/pick.cjs     # Verzeihende Suche (Platte des Moments, Sammlung)
node tools/e2e/nobpm.cjs    # Beschriften: Platten ohne Tempo
node tools/e2e/setgen.cjs   # Set erzeugen: ein Track pro Platte, nie hintereinander
node tools/e2e/curate.cjs   # Set kuratieren: Kiste, Vorschläge, Notiz, Ziehen, Live-Modus
node tools/e2e/history.cjs  # Set-Verlauf: „gespielt vor … im …“ bei Vorschlägen
node tools/e2e/share.cjs    # Kisten-Vorlagen, Set per Link teilen und übernehmen
node tools/e2e/feed.cjs     # Feed: Filter Jahrzehnt/Preis, Wischen nach links
node tools/e2e/grade.cjs    # Zustand bewerten, Pressung anzeigen
node tools/e2e/value.cjs    # Wert der Sammlung, wertvollste Platten, Sortierung nach Wert (dauert ~5 Min.)
node tools/e2e/switch.cjs   # Kontowechsel: lokale Daten des vorherigen Kontos werden entfernt
node tools/e2e/welcome.cjs  # Begrüßung, Einmal-Hinweis
node tools/e2e/fair.cjs     # Plattenbörse: Hast du schon / Wantlist
node tools/e2e/labels.cjs   # Label vervollständigen
node tools/e2e/stylus.cjs   # Nadel-Stunden
node tools/e2e/like.cjs     # Digging: Mag ich, Liste, keine Wantlist
node tools/e2e/year.cjs     # Jahresrückblick und Story-Karte
node tools/e2e/repress.cjs  # Repress-Alarm auf der Wantlist
node tools/e2e/listen.cjs   # Mithören mit simuliertem Mikrofon (124 BPM, Am)
node tools/brand/logo.cjs   # Icons aus dem Logo neu erzeugen
node tools/e2e/sharecard.cjs # Teilen-Karten (Profil, Set) als PNG erzeugen
node tools/e2e/look.cjs <ordner>  # Bilder der wichtigsten Seiten hell/dunkel (Vorher/Nachher)
node tools/e2e/wrap.cjs     # Umbruch-Audit aller Seiten (320/375/390 px, hell/dunkel; SHOTS=1 für Screenshots)
```

`tools/e2e/mock.cjs` mockt `/api/**`: 45 Platten Sammlung (IDs 1–45), 25 Wants (46–70), Feed-Funde (71–100), Freunde kumpel/privat/niemand. Release 5 ist eine Doppel-LP mit 20 Tracks.

## Deployment

Cloudflare Pages, Projekt `crate`, live unter https://crate-8vf.pages.dev

```bash
npm run build && npx wrangler pages deploy --project-name crate --branch main --commit-dirty=true
```

Braucht `CLOUDFLARE_API_TOKEN` (und ggf. `CLOUDFLARE_ACCOUNT_ID`) als Umgebungs-Secret der Sitzung. Fehlt es, Franz bitten, es in den Umgebungseinstellungen von Claude Code anzulegen, nicht im Chat.

Gesetzte Secrets in Cloudflare (nur Namen): `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET`, `SESSION_SECRET`, `LASTFM_API_KEY`, `VAPID_PRIVATE_JWK`, `CRON_SECRET` (auch im Worker `crate-cron`). Optional: `GETSONGBPM_API_KEY` (beantragt, noch offen), `ANTHROPIC_API_KEY`, `AI_ALLOWLIST`, `APP_URL`. Workers AI ist als Binding `AI` in `wrangler.toml`.

## Offen

- `GETSONGBPM_API_KEY` eintragen, sobald Franz ihn hat. Dann Keys-Abdeckung prüfen.
- Impressum/Datenschutz: Anschrift in `web/src/pages/Legal.tsx` (`OPERATOR`) ausfüllen.
- Feed: Filter Format, Position merken.
- Kamera auf echtem iPhone testen lassen. Nativer Scanner erst mit Capacitor.
- Store-Screenshots mit echter Sammlung, eigene Domain, Discogs-App umbenennen (siehe `docs/app-store.md`).
