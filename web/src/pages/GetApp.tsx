// „App holen“: Link für Freunde. Android lädt die APK (Trusted Web Activity), iPhone nutzt den Home-Bildschirm.
// Ohne Anmeldung erreichbar (/app).
import { Link } from "react-router-dom";
import { LogoMark, Wordmark } from "../components/Logo";
import { apkName, inAppBrowser, LATEST_APK } from "../lib/push";
import { EXT_VERSION } from "../../../shared/ext";

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isAndroid = /Android/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Erweiterung für Chrome am Computer: als Ordner laden (ohne Chrome Web Store) */
function ChromeExt() {
  return (
    <section className="getapp-card" id="erweiterung">
      <span className="eyebrow">Chrome am Computer</span>
      <b>Crate neben Discogs und jedem Plattenladen</b>
      <span className="sub">
        Auf Discogs-Plattenseiten siehst du sofort: Hast du schon, steht auf der Wantlist oder ist neu, dazu dein Tempo, deine Tonart und deine Sets. Auf jeder anderen Seite: Text markieren, Rechtsklick, „In Crate nachsehen“.
      </span>
      <a className="btn tinted block" href={`/download/crate-erweiterung.zip?v=${EXT_VERSION}`} download={`crate-erweiterung-${EXT_VERSION}.zip`}>
        Erweiterung laden
      </a>
      <span className="tiny">Version {EXT_VERSION} · ZIP, 0,1 MB. Für Chrome, Edge und Brave am Computer.</span>
      <ol className="getapp-steps">
        <li>Datei laden und entpacken. Darin liegt der Ordner „crate-erweiterung“.</li>
        <li>
          In Chrome die Adresse <b>chrome://extensions</b> öffnen und oben rechts den „Entwicklermodus“ einschalten.
        </li>
        <li>„Entpackte Erweiterung laden“ klicken und den Ordner „crate-erweiterung“ wählen.</li>
        <li>In Crate im selben Browser angemeldet sein. Die Erweiterung nutzt diese Anmeldung.</li>
      </ol>
      <span className="tiny">Den Ordner nicht löschen, Chrome lädt die Erweiterung von dort. Tempo, Tonart und Sets erscheinen, wenn in Crate „Handy und Computer“ eingeschaltet ist.</span>
    </section>
  );
}

function Android({ lead }: { lead: boolean }) {
  return (
    <section className={`getapp-card${lead ? " lead" : ""}`}>
      <span className="eyebrow">Android</span>
      <b>Als App installieren</b>
      <a className="btn primary block lg" href={`/download/crate.apk?v=${LATEST_APK}`} download={`crate-${apkName(LATEST_APK)}.apk`}>
        Crate für Android laden
      </a>
      <span className="tiny">Version {apkName(LATEST_APK)} · APK, 0,5 MB, ab Android 5. Braucht Chrome auf dem Handy.</span>
      <ol className="getapp-steps">
        <li>
          Datei laden und antippen. Sie heißt <b>crate-{apkName(LATEST_APK)}.apk</b>: liegt in deinen Downloads noch eine ältere „crate.apk“, nimm nicht die.
        </li>
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
      {inAppBrowser() && (
        <p className="getapp-warn">
          Du bist gerade im Browser einer anderen App (Instagram, WhatsApp …). Dort fehlt „Zum Home-Bildschirm“. Tipp auf die drei Punkte und wähle <b>In Safari öffnen</b>.
        </p>
      )}
      <ol className="getapp-steps">
        <li>
          Diese Seite in <b>Safari</b> öffnen.
        </li>
        <li>Auf „Teilen“ tippen (Quadrat mit Pfeil): am iPhone unten in der Leiste oder hinter den drei Punkten, am iPad oben rechts.</li>
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
        <p className="sub">Dig deeper.</p>
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
          {!isAndroid && <ChromeExt />}
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
