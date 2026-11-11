# Crate in App Store und Play Store bringen

Stand: November 2026. Crate ist eine installierbare Web-App (PWA) auf Cloudflare. Für die Stores kommt eine native Hülle drumherum (Capacitor für iOS und Android). Der App-Code bleibt derselbe, Updates an der Oberfläche gehen weiter ohne neue Store-Version.

## 1. Discogs

Fragen muss man nicht. Laut den [API-Bedingungen](https://support.discogs.com/hc/en-us/articles/360009334593) ist die Nutzung für Apps erlaubt. Pflicht ist:

| Regel | Stand in Crate |
| --- | --- |
| Hinweis wörtlich: „This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.“ | Login, Impressum, Über Crate |
| „Data provided by Discogs.“ direkt bei den Daten, mit Link (ohne nofollow) auf die Discogs-Seite | `DiscogsCredit` auf Platte, Sammlung, Wantlist, Suche, Diggen, Label, Freund, Shop, Plattenbörse |
| Angezeigte Daten höchstens 6 Stunden älter als bei Discogs | Preise, Sammlungswert, Freunde, Platten-Details werden nach spätestens 6 Stunden neu geholt |
| Kein Auslesen von Discogs-Webseiten, keine Umgehung der Limits | Lesezeichen für den Marktplatz entfernt, Anfragen laufen über die Warteschlange (60/min) |
| Name ohne „Discogs“ | „Crate“. In der Store-Beschreibung nur beschreibend: „für deine Discogs-Sammlung“ |
| Keine Gebühr für Funktionen mit Discogs-Daten ohne schriftliche Erlaubnis, Nutzer- und Marktplatzdaten nie kommerziell | Crate ist kostenlos, keine Werbung |

Vor dem Start in der Discogs-Entwickler-Einstellung: App-Name „Crate“, Beschreibung, Website und die neue Callback-Adresse (siehe 4.) eintragen.

## 2. Was Apple und Google prüfen

| Punkt | Apple | Google | Stand |
| --- | --- | --- | --- |
| Mehr als eine Website (Apple 4.2) | streng | locker | Native Teile nötig, siehe 4. |
| Konto und Daten in der App löschen | Pflicht | Pflicht, dazu eine Lösch-Webseite | Einstellungen → „Alle meine Crate-Daten löschen“ (Server und Gerät), Route `DELETE /api/me` |
| Datenschutzerklärung als Link | Pflicht | Pflicht | `/datenschutz` |
| Angaben zu Daten („Privacy Nutrition Label“, „Data safety“) | Pflicht | Pflicht | siehe 5. |
| Testzugang für die Prüfer | Pflicht | empfohlen | Discogs-Testkonto mit rund 30 Platten anlegen (Franz) |
| „Mit Apple anmelden“ | nicht nötig: Ausnahme für Apps, die sich nur beim Dienst anmelden, dessen Inhalte sie zeigen (4.8) | – | – |
| Keine Abstürze, alle Knöpfe gehen | Pflicht | Pflicht | Browser-Tests, dann Test auf echten Geräten |
| Screenshots vom aktuellen Stand | Pflicht | Pflicht | mit echter Sammlung machen |
| Händler-Status in der EU (DSA) | Pflicht | Pflicht | „kein Händler“, solange kostenlos |
| Geschlossener Test mit 12 Personen über 14 Tage | – | Pflicht für neue private Entwicklerkonten | Testerliste sammeln |

## 3. Was Franz braucht

- Apple Developer Program: 99 US-Dollar im Jahr, am besten als Privatperson oder über Feuerpfeil (dann mit D-U-N-S-Nummer)
- Google Play Console: einmalig 25 US-Dollar, Identitätsprüfung
- Einen Mac mit Xcode für den iOS-Build (oder einen Cloud-Dienst wie Codemagic)
- Ein Android-Gerät und ein iPhone zum Testen
- Eigene Domain (z. B. `kiste.fm` oder `wuehlkiste.app`), damit die App-Adresse nicht `crate-8vf.pages.dev` ist
- 12 Tester für Google (Freunde, Kollegen) mit Google-Konto
- Discogs-Testkonto für die Prüfer

## 4. Technischer Weg

Capacitor mit lokal mitgelieferten Web-Dateien (`web/dist`) und API-Aufrufen an die eigene Domain:

1. `@capacitor/core`, `@capacitor/ios`, `@capacitor/android`, App-ID `de.feuerpfeil.crate`
2. **Login:** Discogs-Anmeldung im System-Browser (`@capacitor/browser`), zurück per Deep Link `crate://login`. Server braucht eine Callback-Route für die App, Sitzung dann per Token statt Cookie.
3. **Native Teile** (gegen 4.2 und für ein besseres Gefühl):
   - Barcode-Scanner nativ (`@capacitor-mlkit/barcode-scanning`)
   - Mitteilungen über APNs und FCM (`@capacitor/push-notifications`); der Server schickt heute Web-Push
   - Haptik (`@capacitor/haptics`), Teilen-Menü (`@capacitor/share`), Kalender-Datei öffnen
   - Offline-Start mit den Daten auf dem Gerät (geht schon)
4. **Info.plist**: Kamera („Crate liest Barcodes und Labels, um Platten zu finden“), Mikrofon („Crate hört mit, um Tempo und Tonart zu messen. Die Aufnahme verlässt das Gerät nicht.“)
5. **Datenschutz-Manifest** (`PrivacyInfo.xcprivacy`) für iOS

## 5. Angaben zum Datenschutz im Store

| Frage | Antwort |
| --- | --- |
| Tracking | Nein |
| Werbung | Nein |
| Erhobene Daten | Benutzerkennung (Discogs-Name), vom Nutzer eingetragene Inhalte (Sets, BPM, Notizen) für den Abgleich zwischen Geräten; optional Profil und Push-Adresse |
| Mit der Person verknüpft | Ja (Discogs-Name), nicht für Tracking |
| Fotos | Nur zur Erkennung kurz an den Server, nicht gespeichert |
| Mikrofon | Nur auf dem Gerät ausgewertet |
| Verschlüsselt übertragen | Ja |
| Löschen | In der App: Einstellungen → „Alle meine Crate-Daten löschen“ |
| Altersfreigabe | 4+ / USK 0, „Unbeschränkter Webzugriff“ angeben (Links zu Discogs und YouTube) |

## 6. Geld verdienen

Kostenlos und ohne Werbung ist mit Discogs problemlos. Bezahlte Funktionen, ein Abo oder ein Kaufpreis für Funktionen mit Discogs-Daten brauchen eine schriftliche Erlaubnis von Discogs. Nutzer- und Marktplatzdaten (Sammlung, Wantlist, Preise) dürfen gar nicht kommerziell genutzt werden. Werbung mit diesen Daten ist verboten, Links, die Käufer von Discogs zu anderen Shops lenken, ebenso. Denkbar ohne Erlaubnis: eine freiwillige „Trinkgeld“-Kasse als In-App-Kauf (Apple und Google verlangen dafür ihr eigenes Bezahlsystem und behalten 15 bis 30 %).

## 7. Reihenfolge

1. Domain kaufen, App auf die Domain umziehen (mit Datenübergabe)
2. Capacitor-Hülle, Login per Deep Link, native Mitteilungen und Scanner
3. Test auf echten Geräten, geschlossener Test bei Google (14 Tage)
4. Store-Einträge, Screenshots, Datenschutz-Angaben, Testkonto für die Prüfer
5. Einreichen
