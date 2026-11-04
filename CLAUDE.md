# Crate – Projektnotizen für Claude

Mobile Web-App (PWA) für Vinyl-DJs auf Basis von Discogs. Besitzer: Franz Kralik (Feuerpfeil, Bayreuth).

## Arbeitsweise

- Mit Franz auf **Deutsch** schreiben. **Keine Gedankenstriche (—)**, keine Buzzwords, kein „Game-Changer“. Gilt auch für Texte in der App.
- Branch: `claude/discogs-vinyl-dj-app-yao8n6`. Kein Pull Request ohne ausdrücklichen Wunsch.
- Commit-Nachrichten auf Deutsch, beschreibend. Keine Modellnamen in Commits oder Code.
- Nie Secrets committen oder Franz bitten, Schlüssel in den Chat zu kopieren.
- Nicht anfassen: das alte Cloudflare-Projekt `vinyl-wantlist`.
- UI-Anspruch: wirkt wie eine große native iOS-App (Apple-Design, Motion, Haptik). Änderungen immer im Handy-Viewport (Playwright, „iPhone 13“) prüfen, hell und dunkel, und mit `tools/e2e/wrap.cjs` auf 320 px gegenprüfen.
- Umbrüche: Silbentrennung nur in Fließtext, nie in Labels, Fragen, Titeln oder Knöpfen. Kurze Labels statt Trennung.

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
- Crate-Profil (DJ-Name, Bio, Ort, bis 5 Links, 6 Styles, Platte des Moments): `shared/profile.ts` (Prüfung, Link-Erkennung), KV `prof:<name>`, Routen `/api/profile/me|:u` (nur angemeldet), Karte `web/src/components/ProfileCard.tsx`, Editor unter `/settings/profile`.
- Textsuche überall über `shared/textSearch.ts` (`matchesQuery`): Satzzeichen/Klammern egal, & = and, Akzente egal. Keine `toLowerCase().includes()`-Suchen mehr bauen.
- Marktplatz-Seiten von Discogs sind für Server gesperrt (403). Angebote kommen über Inventare der Lieblingshändler (API) oder optional das Lesezeichen.
- BPM: Deezer-Album-Matching (`server/audio.ts`, `POST /api/audio/release`, Artist wird getrennt geprüft), dann Einzelsuche, dann Analyse der Hörprobe im Web Worker (`shared/audioAnalysis.ts`, Bassdrum-Band + Kammfilter, Style als Tempo-Hinweis). Gemessen an echten Hörproben: rund 95 % richtig. Keys: nur Analyse (Schätzung) oder GetSongBPM. AcousticBrainz liefert für typische Platten nichts.
- Hörproben laufen über den Server (`/api/audio/preview`). iOS: Ton nur nach Tippen, deshalb ein einziges Audio-Element wiederverwenden.
- Schriften selbst gehostet (`@fontsource-variable/*`), YouTube erst nach Antippen (DSGVO).
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
node tools/e2e/profile.cjs  # Crate-Profil bearbeiten und beim Freund ansehen
node tools/e2e/pick.cjs     # Verzeihende Suche (Platte des Moments, Sammlung)
node tools/e2e/nobpm.cjs    # Beschriften: Platten ohne Tempo
node tools/e2e/setgen.cjs   # Set erzeugen: ein Track pro Platte, nie hintereinander
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
- Feed: Wischen nach links als Geste, Filter Preis/Jahrzehnt/Format, Position merken.
- Kamera auf echtem iPhone testen lassen. Nativer Scanner erst mit Capacitor.
- Store-Screenshots mit echter Sammlung, eigene Domain, Discogs-App umbenennen (siehe `docs/app-store.md`).
