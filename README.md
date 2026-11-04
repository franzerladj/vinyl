# Crate

WebApp fürs Handy für Vinyl-DJs, aufgebaut auf deinem Discogs-Account. Läuft im Browser und lässt sich wie eine App auf den Homescreen legen (PWA).

## Was die App kann

| Bereich | Funktionen |
|---|---|
| **Login** | Anmeldung mit deinem Discogs-Account (OAuth). Sammlung und Wantlist werden synchronisiert und lokal auf dem Handy gespeichert, die App ist dadurch schnell und funktioniert auch im Club ohne Netz. |
| **Wantlist** | Sortieren nach Neueste, Preis, Anzahl Angebote, Artist, Label, Jahr, Titel, Bewertung. Filtern nach Style, „nur verfügbar“, Maximalpreis. Gruppieren nach Label, Style oder Jahrzehnt. Marktpreise (günstigstes Angebot, Anzahl) per Knopfdruck. |
| **Shoppen** | Händler-Optimierer: sucht die Kombination aus möglichst wenigen Händlern mit möglichst geringen Gesamtkosten inkl. Versand. Rangliste „welcher Händler hat die meisten meiner Wants“. Regeln für Maximalpreis, Mindestzustand, Händler-Bewertung und maximale Händleranzahl. Zeigt die Ersparnis gegenüber Einzelkäufen. |
| **Suche** | Komplette Discogs-Datenbank mit Filtern (Vinyl, Genre, Style, Label, Katalognummer, Jahr, Land, Barcode). Direkt zur Wantlist oder Sammlung hinzufügen. |
| **Platte hinzufügen** | Foto von Cover, Label oder Runout machen, die KI liest Artist, Titel, Katalognummer, Barcode ab und schlägt die passende Pressung vor. Alternativ Barcode mit der Kamera scannen oder Katalognummer eintippen. |
| **Sammlung** | Suche über Artist, Titel, Label, Tracks und Regalplatz. Filter nach BPM-Bereich, passender Tonart (Camelot), Style, „ohne Sticker“, „BPM fehlt“. Listen- und Cover-Ansicht. Regalplatz und Crates (Gig-Taschen) je Platte. |
| **Track-Daten** | BPM und Tonart automatisch (Deezer, GetSongBPM), Tap-Tempo zum Selbermessen, Energie 1 bis 10, Vibe-Tags, Sterne, Notizen. 30-Sekunden-Hörproben, YouTube-Videos von Discogs. Optional schätzt die KI Energie und Vibes. |
| **Setlists** | Vorschlag nach Energie-Kurve (Warm-up, Journey, Peak-Time, Bar, Closing), Start- und End-BPM, maximalem BPM-Sprung und harmonischem Mixen über das Camelot-Rad. Anzeige jedes Übergangs (BPM-Differenz, harmonisch / Energy-Boost / Key-Clash), manuell umsortieren, Tracks ergänzen, teilen. **Einpackliste** mit Regalplätzen für den Gig. |
| **Was passt als Nächstes?** | Live-Helfer: aktuellen Track wählen, die App zeigt passende Tracks aus deiner Sammlung innerhalb deines Pitch-Bereichs. |
| **Sticker** | Druckfertige Sticker für die Outer Sleeves: Artist, Titel, Label, Katalognummer, Jahr, Styles, Tracks nach Seite mit BPM, Key/Camelot, Energie, QR-Code zur Discogs-Seite. Vorlagen für A4-Etikettenbögen und 62-mm-Etikettendrucker. **Neue Platten werden automatisch vorgemerkt**, nach dem Druck als erledigt markiert. Bereits benutzte Etiketten auf angebrochenen Bögen lassen sich überspringen. |
| **Google Sheets** | Spiegel von Sammlung, Wantlist, Tracks und Sets in dein eigenes Sheet. BPM/Key-Änderungen aus dem Sheet lassen sich zurückholen. Siehe [google-sheets/README.md](google-sheets/README.md). |
| **Backup** | JSON-Backup aller eigenen Daten, CSV-Export der Tracks. |

## Einrichtung

### 1. Discogs-App anlegen

1. Auf [discogs.com/settings/developers](https://www.discogs.com/settings/developers) „Create an Application“.
2. Callback-URL: `https://DEINE-ADRESSE/api/auth/callback` (lokal: `http://localhost:5173/api/auth/callback`).
3. Consumer Key und Consumer Secret notieren.

### 2. Optionale Schlüssel

- **Foto-Erkennung und Vibe-Tagging:** API-Key von [console.anthropic.com](https://console.anthropic.com). Kosten fallen nur pro Nutzung an, ein Foto kostet wenige Cent.
- **Tonarten:** kostenloser API-Key von [getsongbpm.com/api](https://getsongbpm.com/api). Ohne Key kommen nur BPM-Werte von Deezer.

### 3. Lokal starten

```bash
cp .env.example .env   # Werte eintragen
npm install
npm run dev            # App auf http://localhost:5173
```

Zum Testen auf dem Handy im selben WLAN: `APP_URL` auf die IP des Rechners setzen und `npx vite --host --config web/vite.config.ts` nutzen. Kamera-Funktionen brauchen HTTPS, deshalb besser gleich online stellen.

### 4. Online stellen

Die App braucht einen kleinen Node-Server (für den Discogs-Login, der Consumer Secret darf nicht ins Frontend). Möglichkeiten:

- **Render.com** (kostenloser Plan reicht): Repo verbinden, `render.yaml` wird erkannt, Umgebungsvariablen eintragen. Achtung: der Gratis-Plan schläft nach 15 Minuten ohne Aufruf ein, der erste Aufruf dauert dann ca. 30 Sekunden.
- **Docker** auf einem eigenen Server: `docker build -t crate . && docker run -p 8787:8787 --env-file .env crate`
- Jeder Hoster mit Node 20+: `npm ci && npm run build && npm start`

Danach `APP_URL` auf die echte Adresse setzen und dieselbe Adresse als Callback in der Discogs-App eintragen. Auf dem Handy die Seite öffnen und „Zum Home-Bildschirm“ wählen.

## Händler-Optimierer: woher kommen die Angebote?

Discogs liefert Marktplatz-Angebote zu einem Release **nicht** über die offizielle API, und die Marktplatz-Seiten sind für Server per Cloudflare gesperrt. Darum gibt es zwei Wege:

1. **Lesezeichen „Crate holen“** (empfohlen): läuft auf discogs.com in deinem eingeloggten Browser, liest die Seite [Wantlist im Marktplatz](https://www.discogs.com/sell/mywants) (alle Angebote zu all deinen Wants, gern vorher gefiltert auf „Versand nach Deutschland“) und schickt sie an die App. Einrichtung steht in der App unter *Shoppen → Angebote holen*.
2. **Händler-Inventar prüfen:** über die offizielle API für einen konkreten Händler, z.B. wenn du einen guten Shop gefunden hast und wissen willst, was er sonst noch aus deiner Wantlist hat.

Der Versand wird geschätzt: Nennt ein Angebot Versandkosten, gelten diese, sonst dein Wert für die erste Platte plus Aufschlag je weiterer Platte. Die tatsächlichen Kosten zeigt Discogs im Warenkorb.

Hinweis: Das Lesezeichen liest die HTML-Struktur von Discogs aus. Ändert Discogs die Seite, muss der Parser in `web/src/lib/bookmarklet.ts` angepasst werden.

## Technik

- `web/`: React + Vite + TypeScript, PWA, lokale Datenbank im Browser (IndexedDB über Dexie)
- `server/`: Hono auf Node. Discogs-OAuth 1.0a, Proxy für die Discogs-API (Session verschlüsselt im Cookie, keine Datenbank nötig), Foto-Erkennung über die Claude API, BPM/Key-Lookup
- `shared/`: Händler-Optimierer, Setlist-Algorithmus, Camelot-Tonarten (mit Tests: `npm test`)
- Die App hält das Discogs-Limit von 60 Anfragen pro Minute ein. Beim ersten Sync einer großen Sammlung dauert das Laden aller Tracklists etwa eine Sekunde pro Platte, danach nur noch für neue Platten.

## Ideen für später

- BPM direkt aus dem Mikrofon erkennen, während die Platte läuft
- Preisalarm: Benachrichtigung, wenn ein Want unter einen Wunschpreis fällt
- Gig-Historie: welche Tracks wo gespielt wurden, damit sich Sets nicht wiederholen
- Verliehen-an-Liste
- Export für Rekordbox/Serato-Crates (für digitale Backups)
- Mehrere Etikettenlayouts, z.B. Rücken-Sticker für die Regalsortierung
