import { NavBar } from "../components/ui";

/**
 * Angaben zum Anbieter. VOR DER VERÖFFENTLICHUNG AUSFÜLLEN.
 * Solange Platzhalter drinstehen, zeigt die Seite einen Hinweis.
 */
export const OPERATOR = {
  name: "Franz Kralik",
  street: "Mainstr. 8",
  city: "95444 Bayreuth",
  country: "Deutschland",
  email: "[E-Mail-Adresse]",
  phone: "",
  /** Nur bei Firmen: Registergericht, Registernummer, USt-IdNr. */
  register: "",
  vatId: "",
};

const unfinished = Object.values(OPERATOR).some((v) => v.startsWith("["));

function Draft() {
  return unfinished ? (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <b>Entwurf:</b> Die Angaben in eckigen Klammern müssen vor der Veröffentlichung ausgefüllt werden.
    </div>
  ) : null;
}

export function Impressum() {
  const o = OPERATOR;
  return (
    <>
      <NavBar title="Impressum" backTo="/settings/about" backLabel="Zurück" />
      <article className="page legal">
        <Draft />
        <h1>Impressum</h1>
        <h2>Angaben gemäß § 5 DDG</h2>
        <p>
          {o.name}
          <br />
          {o.street}
          <br />
          {o.city}
          <br />
          {o.country}
        </p>
        <h2>Kontakt</h2>
        <p>
          E-Mail: {o.email}
          {o.phone && (
            <>
              <br />
              Telefon: {o.phone}
            </>
          )}
        </p>
        {o.register && (
          <>
            <h2>Registereintrag</h2>
            <p>{o.register}</p>
          </>
        )}
        {o.vatId && (
          <>
            <h2>Umsatzsteuer-ID</h2>
            <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {o.vatId}</p>
          </>
        )}
        <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p>
          {o.name}, {o.street}, {o.city}
        </p>
        <h2>Hinweis zu Discogs</h2>
        <p>Diese App nutzt die Discogs-API, ist aber nicht mit Discogs verbunden, gesponsert oder von Discogs unterstützt. „Discogs“ ist eine Marke von Zink Media, LLC.</p>
        <h2>Haftung für Inhalte und Links</h2>
        <p>
          Daten zu Platten, Preisen, BPM und Tonarten stammen aus externen Quellen und automatischen Schätzungen. Für ihre Richtigkeit wird keine Gewähr übernommen. Für Inhalte verlinkter Seiten sind ausschließlich deren Betreiber verantwortlich.
        </p>
      </article>
    </>
  );
}

export function Datenschutz() {
  const o = OPERATOR;
  return (
    <>
      <NavBar title="Datenschutz" backTo="/settings/about" backLabel="Zurück" />
      <article className="page legal">
        <Draft />
        <h1>Datenschutz</h1>
        <p>Kurz gesagt: Crate hat kein Nutzerkonto, kein Tracking und keine Werbung. Deine Sammlung, Sets und Notizen liegen auf deinem Gerät. Damit sie auf Handy und Computer gleich sind, gleicht der Server das, was du in Crate selbst einträgst, zwischen deinen Geräten ab (siehe Punkt 11). Wenn du Mitteilungen einschaltest, liegt ein kleiner Teil davon zusätzlich auf dem Server (siehe Punkt 10).</p>

        <h2>1. Verantwortlicher</h2>
        <p>
          {o.name}, {o.street}, {o.city}, {o.country}. E-Mail: {o.email}
        </p>

        <h2>2. Hosting</h2>
        <p>
          Die App wird bei Cloudflare, Inc. (101 Townsend St, San Francisco, CA 94107, USA) betrieben. Beim Aufruf verarbeitet Cloudflare technisch nötige Daten wie IP-Adresse, Zeitpunkt und aufgerufene Adresse, um die App auszuliefern und vor Angriffen zu schützen (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare ist unter dem EU-US Data Privacy Framework zertifiziert, zusätzlich gelten Standardvertragsklauseln.
        </p>

        <h2>3. Anmeldung mit Discogs</h2>
        <p>
          Die Anmeldung läuft über Discogs (Zink Media, LLC, USA). Dein Passwort sieht die App nie. Nach der Anmeldung speichert die App deinen Discogs-Zugangsschlüssel verschlüsselt in einem Cookie auf deinem Gerät. Dieses Cookie ist technisch nötig, damit die App funktioniert (§ 25 Abs. 2 Nr. 2 TDDDG, Art. 6 Abs. 1 lit. b DSGVO). Anfragen an Discogs und Cover-Bilder lädt dein Gerät direkt von Discogs. Es gilt die Datenschutzerklärung von Discogs.
        </p>

        <h2>4. Daten auf deinem Gerät</h2>
        <p>
          Sammlung, Wantlist, Preise, BPM, Sets, Händler und Einstellungen speichert die App im Browser-Speicher (IndexedDB) auf deinem Gerät. Sie werden nicht an den Betreiber übertragen. Du kannst sie jederzeit unter Einstellungen → Daten löschen oder dich abmelden.
        </p>

        <h2>5. Musikdaten von Drittanbietern</h2>
        <p>
          Um BPM, Tonart und Stimmung zu ergänzen, fragt der Server der App mit Artist und Titel bei Deezer (Deezer SA, Frankreich), Last.fm (Last.fm Ltd., Großbritannien) und GetSongBPM an. Dabei werden keine Daten über dich übertragen, nur die Namen der Tracks. Hörproben werden über den Server der App geladen und auf deinem Gerät analysiert.
        </p>

        <h2>6. Videos von YouTube</h2>
        <p>
          Videos werden erst geladen, wenn du sie antippst, oder direkt, wenn du dem beim ersten Video oder in den Einstellungen zugestimmt hast. Die Zustimmung kannst du dort jederzeit widerrufen. Dann stellt dein Gerät eine Verbindung zu YouTube (Google Ireland Ltd.) her, im erweiterten Datenschutzmodus (youtube-nocookie.com). Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).
        </p>

        <h2>7. Platten per Foto erkennen</h2>
        <p>
          Barcodes und Text liest die App direkt auf dem Gerät. Für die Texterkennung lädt sie beim ersten Mal die Erkennungsdateien von jsDelivr (Prospect One, Polen), dabei wird deine IP-Adresse übertragen. Nur wenn das nicht reicht, schickt sie das Foto an den Server, der es mit einem Bildmodell (Cloudflare Workers AI, bei eigenem Schlüssel Anthropic) auswertet. Das Foto wird danach nicht gespeichert.
        </p>

        <h2>8. Google-Tabelle (optional)</h2>
        <p>
          Wenn du die Spiegelung in eine Google-Tabelle einrichtest, schickt dein Gerät die Daten deiner Sammlung an die von dir eingerichtete Google-Apps-Script-Adresse. Dafür gilt die Datenschutzerklärung von Google.
        </p>

        <h2>9. Freunde</h2>
        <p>Die Freunde-Funktion liest öffentliche Discogs-Profile und Sammlungen der Nutzer, deren Namen du einträgst. Die Daten liegen nur auf deinem Gerät.</p>
        <p>Wenn du „Für Freunde auffindbar“ einschaltest, speichert der Server deinen Discogs-Namen, deinen Namen, Ort, Profilbild und die Anzahl deiner Platten, wie sie öffentlich auf Discogs stehen. Andere angemeldete Crate-Nutzer finden dich dann über die Suche. Ausschalten löscht den Eintrag sofort. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).</p>
        <p>Wenn du dein Crate-Profil ausfüllst (DJ-Name, Bio, Ort, Links, Styles, Platte des Moments), speichert der Server diese Angaben und zeigt sie angemeldeten Crate-Nutzern, die dein Profil öffnen. Leerst du alle Felder und speicherst, wird das Profil gelöscht. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).</p>

        <h2>10. Mitteilungen (optional)</h2>
        <p>
          Wenn du Mitteilungen einschaltest, speichert der Server bei Cloudflare (KV-Speicher): die Push-Adresse deines Geräts, deinen Discogs-Zugangsschlüssel (verschlüsselt), deine Wants mit Wunschpreisen, verliehene Platten und Set-Termine. Damit prüft er alle 10 Minuten bei Discogs Preise und Verfügbarkeit und erinnert dich an Termine. Fügt dich jemand als Freund hinzu, merkt sich der Server das bis zu 60 Tage, um dir Bescheid zu geben. Zugestellt werden Mitteilungen über den Push-Dienst deines Browsers (Apple, Google oder Mozilla). Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Schaltest du Mitteilungen aus, werden diese Daten gelöscht.
        </p>

        <h2>11. Abgleich zwischen deinen Geräten</h2>
        <p>
          Damit BPM, Tonarten, Energie, Sterne, Notizen, Cue-Punkte, Sets, Regalplätze, Kisten-Vorlagen, Wunschpreise, Lieblingshändler, Freundesliste, Likes und Nadel-Stunden auf allen deinen Geräten gleich sind, speichert der Server diese Angaben unter deinem Discogs-Namen in einer Datenbank bei Cloudflare (Cloudflare D1). Nur du kannst sie abrufen, wenn du mit deinem Discogs-Konto angemeldet bist. Rechtsgrundlage ist die Bereitstellung der App (Art. 6 Abs. 1 lit. b DSGVO). Unter Einstellungen, „Handy und Computer“ kannst du den Abgleich ausschalten und die Daten vom Server löschen.
        </p>

        <h2>12. Schriften</h2>
        <p>Alle Schriften werden von der App selbst ausgeliefert. Es besteht keine Verbindung zu Google Fonts oder anderen Schriftanbietern.</p>

        <h2>13. Deine Rechte</h2>
        <p>
          Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15 bis 21 DSGVO). Wende dich dafür an {o.email}. Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, in Bayern beim Bayerischen Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach.
        </p>
        <p className="tiny">Stand: {new Date(__BUILD_DATE__).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</p>
      </article>
    </>
  );
}
