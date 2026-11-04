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

## Offene Fragen an Franz

- Soll der Feed auch auf der Startseite einen Einstieg bekommen („Jetzt diggen“)?
- Ton beim Start: sofort mit Ton (nach dem ersten Tippen) oder erst stumm mit Untertitel „Tippen für Ton“?
