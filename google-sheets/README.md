# Google-Sheets-Spiegel

Crate kann deine Daten in ein eigenes Google Sheet schreiben. So hast du alles zusätzlich als Liste, kannst filtern, teilen, ausdrucken und BPM/Keys bequem am Rechner pflegen.

## Einrichten (5 Minuten)

1. Neues Google Sheet anlegen, z.B. „Crate“.
2. **Erweiterungen → Apps Script** öffnen, den Inhalt von [`Code.gs`](Code.gs) einfügen.
3. Oben `SECRET` auf ein eigenes Geheimwort ändern und speichern.
4. **Bereitstellen → Neue Bereitstellung → Web-App**
   - Ausführen als: *Ich*
   - Zugriff: *Jeder*
5. Google fragt nach Berechtigungen, bestätigen. Die angezeigte URL endet auf `/exec`.
6. In Crate unter **Einstellungen → Google Sheets** URL und Geheimwort eintragen.

## Was passiert

**→ In Sheets schreiben** legt diese Blätter an bzw. überschreibt sie komplett:

| Blatt | Inhalt |
|---|---|
| Collection | Alle Platten mit Label, Katalognummer, Styles, Regalplatz, Sticker-Status |
| Wantlist | Wants mit günstigstem Preis und Anzahl Angebote |
| Tracks | Jeder Track mit BPM, Key, Camelot, Energie, Vibes, Sternen, Notiz |
| Sets | Alle gespeicherten Setlists |

**← Tracks zurückholen** liest das Blatt *Tracks* und übernimmt BPM, Key, Energie, Vibes, Sterne und Notizen in die App. Die Spalte „Track-ID“ nicht verändern.

Reihenfolge, wenn du im Sheet etwas geändert hast: erst **zurückholen**, dann **schreiben**. Schreiben überschreibt das Blatt.
