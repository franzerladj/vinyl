# Crate

WebApp fürs Handy für Vinyl-DJs, aufgebaut auf deinem Discogs-Account. Läuft im Browser und lässt sich wie eine App auf den Homescreen legen (PWA).

## Was die App kann

| Bereich | Funktionen |
|---|---|
| **Design** | Orientiert an Apples Gestaltungsregeln: Hell- und Dunkelmodus, große Titel mit kompakter Leiste beim Scrollen, Cover-Übergänge zwischen Liste und Detailseite, Bottom-Sheets zum Wegwischen, Platte, die beim Reinhören hinter dem Cover rotiert, Haptik auf Android, reduzierte Bewegung wird respektiert. |
| **Login** | Anmeldung mit deinem Discogs-Account (OAuth). Sammlung und Wantlist werden synchronisiert und lokal auf dem Handy gespeichert, die App ist dadurch schnell und funktioniert auch im Club ohne Netz. |
| **Wantlist** | Sortieren nach Neueste, Preis, Anzahl Angebote, Artist, Label, Jahr, Titel, Bewertung. Filtern nach Style, „nur verfügbar“, Maximalpreis. Gruppieren nach Label, Style oder Jahrzehnt. Marktpreise (günstigstes Angebot, Anzahl) per Knopfdruck. |
| **Shoppen** | Händler-Optimierer: sucht die Kombination aus möglichst wenigen Händlern mit möglichst geringen Gesamtkosten inkl. Versand. Rangliste „welcher Händler hat die meisten meiner Wants“. Regeln für Maximalpreis, Mindestzustand, Händler-Bewertung und maximale Händleranzahl. Zeigt die Ersparnis gegenüber Einzelkäufen. |
| **Suche** | Komplette Discogs-Datenbank mit Filtern (Vinyl, Genre, Style, Label, Katalognummer, Jahr, Land, Barcode). Direkt zur Wantlist oder Sammlung hinzufügen. |
| **Platte hinzufügen** | Foto von Cover, Label oder Runout: die App liest Katalognummer, Barcode und Text (kostenlos auf dem Handy oder per Bildmodell) und schlägt die passende Pressung vor. Alternativ Barcode mit der Kamera scannen oder Katalognummer eintippen. |
| **Sammlung** | Suche über Artist, Titel, Label, Tracks und Regalplatz. Filter nach BPM-Bereich, passender Tonart (Camelot), Style, „ohne Sticker“, „BPM fehlt“. Listen- und Cover-Ansicht. Regalplatz und Crates (Gig-Taschen) je Platte. |
| **Track-Daten** | BPM und Tonart automatisch (Deezer, GetSongBPM, Analyse der Hörprobe), Tap-Tempo zum Selbermessen, Energie 1 bis 10, Vibe-Tags (Styles, Last.fm, gemessene Energie), Sterne, Notizen. 30-Sekunden-Hörproben, YouTube-Videos von Discogs. |
| **Setlists** | Vorschlag nach Energie-Kurve (Warm-up, Journey, Peak-Time, Bar, Closing), Start- und End-BPM, maximalem BPM-Sprung und harmonischem Mixen über das Camelot-Rad. Anzeige jedes Übergangs (BPM-Differenz, harmonisch / Energy-Boost / Key-Clash), manuell umsortieren, Tracks ergänzen, teilen. **Einpackliste** mit Regalplätzen für den Gig. |
| **Was passt als Nächstes?** | Live-Helfer: aktuellen Track wählen, die App zeigt passende Tracks aus deiner Sammlung innerhalb deines Pitch-Bereichs. |
| **Beschriften** | Drei Varianten für die Außenhülle: **Einleger-Karte** (A6, A5 oder Quadrat, kommt vor das Cover in die transparente Hülle, nichts klebt auf dem Original), **Obi-Streifen** (schmal für die Seite, auch im Regal lesbar) und **Sticker** (A4-Etikettenbögen, 62-mm-Etikettendrucker). Inhalt: Artist, Titel, Katalognummer, Tracks nach Seite mit BPM, farbigem Camelot-Key, Energie, Styles, QR-Code. Looks: Weiß, Schwarz oder in den Farben des Covers. **Neue Platten werden automatisch vorgemerkt**, nach dem Druck als erledigt markiert. |
| **Google Sheets** | Spiegel von Sammlung, Wantlist, Tracks und Sets in dein eigenes Sheet. BPM/Key-Änderungen aus dem Sheet lassen sich zurückholen. Siehe [google-sheets/README.md](google-sheets/README.md). |
| **Backup** | JSON-Backup aller eigenen Daten, CSV-Export der Tracks. |

## Einrichtung

Empfohlen ist **Cloudflare Pages**: kostenlos, schläft nie ein, HTTPS und eigene Domain inklusive. Die App-Dateien liefert Pages aus, die API läuft als Pages Functions (`functions/`), das kostenlose KI-Kontingent kommt von Workers AI.

### 1. Discogs-App anlegen

1. Auf [discogs.com/settings/developers](https://www.discogs.com/settings/developers) „Create an Application“.
2. Callback-URL: `https://DEINE-ADRESSE/api/auth/callback`, z.B. `https://crate.pages.dev/api/auth/callback`.
3. Consumer Key und Consumer Secret notieren.

### 2. Auf Cloudflare Pages veröffentlichen

1. Kostenlosen Account auf [dash.cloudflare.com](https://dash.cloudflare.com) anlegen.
2. **Workers & Pages → Create → Pages → Connect to Git**, das Repo `vinyl` auswählen.
3. Build-Einstellungen:
   - Framework preset: *None*
   - Build command: `npm run build`
   - Build output directory: `web/dist`
4. **Settings → Variables and Secrets → Add** (für *Production*), jeweils als Typ **Secret**:
   - `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET`
   - `SESSION_SECRET` (zufällig, mind. 32 Zeichen)
   - optional `LASTFM_API_KEY`, `GETSONGBPM_API_KEY`, `ANTHROPIC_API_KEY`, `AI_ALLOWLIST`
5. Das Workers-AI-Binding für die kostenlose Foto-Erkennung steht schon in `wrangler.toml` und wird automatisch übernommen. Diese Datei ist für Bindings und normale Variablen maßgeblich, im Dashboard sind sie dann nur lesbar. Secrets lassen sich weiter im Dashboard pflegen.
6. Neu deployen. Jeder Push auf den Branch baut die App automatisch neu.
7. Optional unter **Custom domains** eine eigene Adresse wie `crate.deinedomain.de` verbinden und die Callback-URL bei Discogs anpassen.

Auf dem Handy die Seite öffnen und „Zum Home-Bildschirm“ wählen.

### Mit Kumpels teilen

Einfach den Link schicken. Jeder meldet sich mit dem eigenen Discogs-Account an. Sammlung, BPM-Daten und Sets liegen auf dem jeweiligen Handy, auf dem Server wird nichts gespeichert. Das Discogs-Limit gilt pro Person.

Kosten: Alles außer Claude ist kostenlos. Claude bezahlt nur, wer in `AI_ALLOWLIST` steht (dein Key) oder in der App einen eigenen Anthropic-Key einträgt.

### Was kostenlos läuft und was optional ist

| Funktion | Kostenlos | Optional mit Claude |
|---|---|---|
| Platte erkennen | Barcode-Scan, Texterkennung auf dem Handy (Tesseract), Bildmodell von Workers AI (Tageskontingent) | Beste Erkennung auch bei schwierigen Covern |
| BPM | Deezer, GetSongBPM, Analyse der Hörprobe, Tap-Tempo | |
| Tonart | GetSongBPM, Analyse der Hörprobe (Schätzung) | |
| Energie & Vibes | Regeln aus Styles und BPM, Last.fm-Tags, gemessene Energie der Hörprobe | KI kennt viele Tracks und schätzt genauer |

Manuell eingetragene Werte werden von automatischen Schätzungen nie überschrieben.

### Lokal entwickeln

```bash
cp .env.example .env   # Werte eintragen
npm install
npm run dev            # App auf http://localhost:5173 (Node-Server, ohne Workers AI)
npm test
```

Alternativ wie auf Cloudflare: `.env.example` als `.dev.vars` kopieren und `npm run cf:dev`. Das Workers-AI-Binding braucht dabei einen Login bei Cloudflare (`npx wrangler login`).

### Andere Hoster

Der Node-Server (`server/index.ts`) läuft weiterhin überall, wo Node 20+ verfügbar ist: `npm ci && npm run build && npm start`, per Docker (`Dockerfile`) oder auf Render (`render.yaml`). Dort gibt es kein Workers AI. Die Texterkennung auf dem Handy und alle anderen Gratis-Funktionen gehen trotzdem.

## Händler-Optimierer: woher kommen die Angebote?

Discogs liefert Marktplatz-Angebote zu einem Release **nicht** über die offizielle API, und die Marktplatz-Seiten sind für Server per Cloudflare gesperrt. Darum gibt es zwei Wege:

1. **Lesezeichen „Crate holen“** (empfohlen): läuft auf discogs.com in deinem eingeloggten Browser, liest die Seite [Wantlist im Marktplatz](https://www.discogs.com/sell/mywants) (alle Angebote zu all deinen Wants, gern vorher gefiltert auf „Versand nach Deutschland“) und schickt sie an die App. Einrichtung steht in der App unter *Shoppen → Angebote holen*.
2. **Händler-Inventar prüfen:** über die offizielle API für einen konkreten Händler, z.B. wenn du einen guten Shop gefunden hast und wissen willst, was er sonst noch aus deiner Wantlist hat.

Der Versand wird geschätzt: Nennt ein Angebot Versandkosten, gelten diese, sonst dein Wert für die erste Platte plus Aufschlag je weiterer Platte. Die tatsächlichen Kosten zeigt Discogs im Warenkorb.

Hinweis: Das Lesezeichen liest die HTML-Struktur von Discogs aus. Ändert Discogs die Seite, muss der Parser in `web/src/lib/bookmarklet.ts` angepasst werden.

## Technik

- `web/`: React + Vite + TypeScript, PWA, lokale Datenbank im Browser (IndexedDB über Dexie)
- `server/`: Hono-App, läuft als Cloudflare Pages Function (`functions/api/[[path]].ts`) und unter Node (`server/index.ts`). Discogs-OAuth 1.0a, Proxy für die Discogs-API (Session verschlüsselt im Cookie, keine Datenbank nötig), Foto-Erkennung (Claude oder Workers AI), BPM/Key-Lookup, Last.fm, Hörproben-Proxy
- `shared/`: Händler-Optimierer, Setlist-Algorithmus, Camelot-Tonarten, Vibe-Regeln, Audio-Analyse (Tempo, Tonart, Energie) mit Tests: `npm test`
- Die App hält das Discogs-Limit von 60 Anfragen pro Minute ein. Beim ersten Sync einer großen Sammlung dauert das Laden aller Tracklists etwa eine Sekunde pro Platte, danach nur noch für neue Platten.

## Ideen für später

- BPM direkt aus dem Mikrofon erkennen, während die Platte läuft
- Preisalarm: Benachrichtigung, wenn ein Want unter einen Wunschpreis fällt
- Gig-Historie: welche Tracks wo gespielt wurden, damit sich Sets nicht wiederholen
- Verliehen-an-Liste
- Export für Rekordbox/Serato-Crates (für digitale Backups)
- Mehrere Etikettenlayouts, z.B. Rücken-Sticker für die Regalsortierung
