# Plan: Digging-Feed („Diggen“) in der Suche

Wunsch: Wenn man in der Suche nichts eingibt, erscheint ein Feed zum Durchwischen wie bei TikTok. Eine Platte pro Bildschirm, Hörprobe läuft sofort, mit Wantlist, Warenkorb und Filtern. Digitales Diggen.

## Bedienung

- Vollbild-Karten, senkrecht wischen (Scroll-Snap), eine Platte pro Bildschirm
- Hintergrund: unscharfes Cover, davor Cover groß, Artist, Titel, Label, Jahr, Styles, ab-Preis und Anzahl Angebote
- Hörprobe startet beim Erscheinen der Karte: passendes YouTube-Video der Discogs-Seite, sonst Deezer-Hörprobe
  - iPhone/Safari: Ton erst nach dem ersten Tippen (Apple-Regel). Danach läuft jede Karte automatisch mit Ton.
- Rechte Seite wie bei TikTok, große runde Knöpfe:
  - ♥ auf die Wantlist (Doppeltipp auf die Karte macht dasselbe, mit Herz-Animation)
  - ＋ in die Sammlung
  - 🛒 Marktplatz bzw. „bei Lieblingshändler“, falls dort vorhanden
  - ↗ teilen
  - „Mehr davon“: Feed zieht mehr vom selben Label, Artist und Style nach
- Nach links wischen: „Nicht mein Ding“ (merkt sich die App und zeigt weniger davon)
- Nach oben ziehen: Detailblatt mit Tracklist (Tracks antippen spielt sie), Videos, Freunde, die die Platte haben

## Woher die Platten kommen (Mischung)

Discogs hat keine „Trending“-Schnittstelle, deshalb mischt die App mehrere Quellen:

1. **Für dich:** Releases von Labels und Artists aus deiner Sammlung, die du noch nicht hast (`/labels/{id}/releases`, `/artists/{id}/releases`), gewichtet nach deinen Lieblings-Styles
2. **Neu erschienen:** Datenbanksuche `format=Vinyl`, aktuelles und letztes Jahr, deine Styles; sortiert nach Nachfrage (Want-Zahl aus `community`)
3. **Gesucht und selten:** hohe Nachfrage im Verhältnis zu Angeboten (Want/Have, Marktstatistik)
4. **Von Freunden:** neu in den Sammlungen deiner Freunde
5. **Zufallsfund:** zufällige Seite einer Style-Suche, damit es nicht immer dasselbe ist

Bereits in Sammlung oder Wantlist, oder schon weggewischt: wird ausgeblendet.

## Filter (oben als Chips, Details im Sheet)

- Genre und Style (Mehrfachauswahl, Vorschläge aus deiner Sammlung)
- Jahrzehnt bzw. „nur Neuerscheinungen“
- Quelle (Für dich / Neu / Selten / Freunde / Zufall)
- Höchstpreis, nur verfügbar
- Format (12", 7", LP)

## Technik

- Discogs-Limit 60/min: Der Feed lädt Karten im Voraus (die nächsten 3 bis 5 Details inkl. Videos), Suchergebnisse werden zwischengespeichert. Nutzeraktionen haben Vorrang vor dem Hintergrund-Sync.
- Lernen ohne Server: Likes, Wantlist und Wegwischen erhöhen oder senken lokal das Gewicht von Style, Label und Artist
- Ein Feed-Zustand pro Gerät (Position, gemischte Warteschlange), damit man nach dem Schließen weiter diggen kann
- Komponenten: `pages/Dig.tsx` (Feed), `lib/dig.ts` (Quellen, Mischung, Gewichte), Einstieg in `pages/Search.tsx`, wenn das Suchfeld leer ist
- Tests: Mischung und Gewichtung (`shared/dig.ts`), Scroll-Snap und Autoplay im Browser-Test

## Stand

Version 1 ist umgesetzt (`web/src/pages/Dig.tsx`, `web/src/lib/dig.ts`, `shared/dig.ts`, Tests in `tests/dig.test.ts`):

- Einstieg „Jetzt diggen“ auf der Startseite und „Diggen statt suchen“ in der leeren Suche
- Ton nach dem ersten Tippen (iPhone-Regel), danach spielt jede Karte automatisch über denselben Audio-Player
- Tippen: Ton an/aus. Doppeltippen: Wantlist mit Herz. Knöpfe: Want, Hab ich, Kaufen, Mehr davon, Teilen, Weg
- Quellen: Labels und Artists aus der Sammlung, Neuerscheinungen, gesuchte Raritäten, Zufallsfunde, Freunde
- Lernen nur auf dem Gerät, Style-Filter als Chips
- Ohne Deezer-Hörprobe: Knopf „Video ansehen“ (YouTube erst nach Antippen)

Noch offen: Wischen nach links als Geste, Filter für Preis, Jahrzehnt und Format, Feed-Position nach dem Schließen merken.
