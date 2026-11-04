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
- Marktplatz-Seiten von Discogs sind für Server gesperrt (403). Angebote kommen über Inventare der Lieblingshändler (API) oder optional das Lesezeichen.
- BPM: Deezer-Album-Matching (`server/audio.ts`, `POST /api/audio/release`, Artist wird getrennt geprüft), dann Einzelsuche, dann Analyse der Hörprobe im Web Worker (`shared/audioAnalysis.ts`, Bassdrum-Band + Kammfilter, Style als Tempo-Hinweis). Gemessen an echten Hörproben: rund 95 % richtig. Keys: nur Analyse (Schätzung) oder GetSongBPM. AcousticBrainz liefert für typische Platten nichts.
- Hörproben laufen über den Server (`/api/audio/preview`). iOS: Ton nur nach Tippen, deshalb ein einziges Audio-Element wiederverwenden.
- Schriften selbst gehostet (`@fontsource-variable/*`), YouTube erst nach Antippen (DSGVO).

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
node tools/e2e/ship.cjs     # Versand-Schätzung
node tools/e2e/tap.cjs      # Tap-Tempo
node tools/e2e/wrap.cjs     # Umbruch-Audit aller Seiten (320/375/390 px, hell/dunkel; SHOTS=1 für Screenshots)
```

`tools/e2e/mock.cjs` mockt `/api/**`: 45 Platten Sammlung (IDs 1–45), 25 Wants (46–70), Feed-Funde (71–100), Freunde kumpel/privat/niemand. Release 5 ist eine Doppel-LP mit 20 Tracks.

## Deployment

Cloudflare Pages, Projekt `crate`, live unter https://crate-8vf.pages.dev

```bash
npm run build && npx wrangler pages deploy --project-name crate --branch main --commit-dirty=true
```

Braucht `CLOUDFLARE_API_TOKEN` (und ggf. `CLOUDFLARE_ACCOUNT_ID`) als Umgebungs-Secret der Sitzung. Fehlt es, Franz bitten, es in den Umgebungseinstellungen von Claude Code anzulegen, nicht im Chat.

Gesetzte Secrets in Cloudflare (nur Namen): `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET`, `SESSION_SECRET`, `LASTFM_API_KEY`. Optional: `GETSONGBPM_API_KEY` (beantragt, noch offen), `ANTHROPIC_API_KEY`, `AI_ALLOWLIST`, `APP_URL`. Workers AI ist als Binding `AI` in `wrangler.toml`.

## Offen

- `GETSONGBPM_API_KEY` eintragen, sobald Franz ihn hat. Dann Keys-Abdeckung prüfen.
- Impressum/Datenschutz: Anschrift in `web/src/pages/Legal.tsx` (`OPERATOR`) ausfüllen.
- Feed: Wischen nach links als Geste, Filter Preis/Jahrzehnt/Format, Position merken.
- Kamera auf echtem iPhone testen lassen. Nativer Scanner erst mit Capacitor.
- Store-Screenshots mit echter Sammlung, eigene Domain, Discogs-App umbenennen (siehe `docs/app-store.md`).
