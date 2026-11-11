// „App holen“: Link für Freunde. Android lädt die APK (Trusted Web Activity), iPhone nutzt den Home-Bildschirm.
// Ohne Anmeldung erreichbar (/app).
import { Link } from "react-router-dom";
import { LogoMark, Wordmark } from "../components/Logo";

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isAndroid = /Android/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

function Android({ lead }: { lead: boolean }) {
  return (
    <section className={`getapp-card${lead ? " lead" : ""}`}>
      <span className="eyebrow">Android</span>
      <b>Als App installieren</b>
      <a className="btn primary block lg" href="/download/crate.apk" download>
        Crate für Android laden
      </a>
      <span className="tiny">APK, 0,5 MB, ab Android 5. Braucht Chrome auf dem Handy.</span>
      <ol className="getapp-steps">
        <li>Datei laden und antippen.</li>
        <li>Fragt Android nach „Unbekannte Apps installieren“: für den Browser einmal erlauben.</li>
        <li>„Installieren“ tippen, dann Crate öffnen und mit Discogs anmelden.</li>
      </ol>
      <span className="tiny">Updates kommen automatisch, die Datei musst du nur einmal laden.</span>
    </section>
  );
}

function IPhone({ lead }: { lead: boolean }) {
  return (
    <section className={`getapp-card${lead ? " lead" : ""}`}>
      <span className="eyebrow">iPhone und iPad</span>
      <b>Auf den Home-Bildschirm legen</b>
      <ol className="getapp-steps">
        <li>
          Diese Seite in <b>Safari</b> öffnen.
        </li>
        <li>Unten auf „Teilen“ tippen (Quadrat mit Pfeil).</li>
        <li>„Zum Home-Bildschirm“ wählen, dann „Hinzufügen“.</li>
        <li>Crate vom Home-Bildschirm aus öffnen und mit Discogs anmelden.</li>
      </ol>
      <span className="tiny">Mitteilungen gehen auf dem iPhone nur so. Eine App im App Store kommt später.</span>
    </section>
  );
}

export default function GetApp() {
  return (
    <div className="getapp">
      <header className="getapp-head">
        <LogoMark size={88} />
        <Wordmark className="getapp-word" />
        <p className="sub">Aus der Kiste auf den Teller.</p>
      </header>
      {standalone ? (
        <section className="getapp-card lead">
          <b>Crate ist schon installiert</b>
          <span className="sub">Du nutzt gerade die App.</span>
          <Link className="btn primary block lg" to="/">
            Zu Crate
          </Link>
        </section>
      ) : isIOS ? (
        <>
          <IPhone lead />
          <Android lead={false} />
        </>
      ) : (
        <>
          <Android lead={isAndroid} />
          <IPhone lead={false} />
          {!isAndroid && (
            <section className="getapp-card">
              <span className="eyebrow">Computer</span>
              <b>Im Browser oder als Programm</b>
              <span className="sub">In Chrome oder Edge rechts in der Adressleiste auf „App installieren“ klicken. Am Mac in Safari: Ablage, „Zum Dock hinzufügen“.</span>
              <Link className="btn tinted block" to="/">
                Crate im Browser öffnen
              </Link>
            </section>
          )}
        </>
      )}
      <p className="tiny getapp-foot">
        Kostenlos, ohne Werbung. Du meldest dich mit deinem Discogs-Konto an.
        <br />
        <Link to="/impressum">Impressum</Link> · <Link to="/datenschutz">Datenschutz</Link>
      </p>
    </div>
  );
}
