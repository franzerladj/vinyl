import { useEffect, useState } from "react";
import type { Me } from "../lib/api";
import { completeLogin, startLogin } from "../lib/auth";
import { LogoMark, Wordmark } from "../components/Logo";
import { inAppBrowser, isIOS, isStandalone, openInChromeUrl, runningAs } from "../lib/push";

// Wie eine Tracklist auf dem Label: Seite A, Seite B
const SIDES: [string, string, string][] = [
  ["A1", "Sammlung & Wantlist", "Nach Label, Katalognummer, Jahr und Preis sortieren. Zustand und Pressung immer dabei."],
  ["A2", "Digging", "Neues aus deinen Labels und Styles, mit Hörprobe. Wischen, merken, weiter."],
  ["B1", "Weniger Porto", "Findet die Händler, die gleich mehrere deiner Wants haben."],
  ["B2", "Sets aus der Kiste", "Platten einpacken, Reihenfolge bauen, BPM, Key und Mix-Notizen."],
];

export default function Login({ me }: { me: Me | null }) {
  const status = new URLSearchParams(location.search).get("login");
  const [busyText, setBusyText] = useState<string | null>(null);
  const android = /Android/i.test(navigator.userAgent);
  const inApp = runningAs().startsWith("Android-App");
  const iosApp = isIOS() && isStandalone();
  useEffect(() => {
    const back = (e: PageTransitionEvent) => e.persisted && setBusyText(null);
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);
  return (
    <div className="app" style={{ paddingBottom: 0 }}>
      <div className="hero">
        <div className="login-mark">
          <LogoMark size={128} animate />
        </div>
        <Wordmark className="login-word" />
        <p className="login-claim">Dig deeper.</p>
        <ol className="side-list">
          {SIDES.map(([pos, t, d], i) => (
            <li key={pos} style={{ animation: `rise .6s var(--ease) ${0.45 + i * 0.07}s both` }}>
              <span className="pos">{pos}</span>
              <div>
                <b>{t}</b>
                <span className="sub">{d}</span>
              </div>
            </li>
          ))}
        </ol>
        <div style={{ marginTop: "auto" }}>
          {status === "failed" && !busyText && <p style={{ color: "var(--bad)" }}>Die Anmeldung hat nicht geklappt. Bitte noch einmal versuchen.</p>}
          {status === "busy" && !busyText && <p style={{ color: "var(--warn)" }}>Discogs war gerade ausgelastet. Einfach noch einmal tippen, meistens klappt es beim zweiten Mal.</p>}
          {busyText && <p className="sub" aria-live="polite">{busyText}</p>}
          {inAppBrowser() && (
            <p className="getapp-warn" style={{ marginBottom: 12 }}>
              Du bist im Browser einer anderen App (Instagram, WhatsApp …). Dort klappt die Anmeldung oft nicht, zum Beispiel öffnet sich die Tastatur nicht. Tipp auf die drei Punkte und öffne die Seite in Chrome oder Safari.
              {android && (
                <>
                  {" "}
                  <a href={openInChromeUrl("/")}>In Chrome öffnen</a>
                </>
              )}
            </p>
          )}
          {me?.features.oauth === false ? (
            <p className="sub">Auf dem Server fehlt der Discogs-Consumer-Key. Siehe README, Abschnitt Einrichtung.</p>
          ) : (
            <button
              className="btn primary block lg"
              disabled={!!busyText}
              onClick={() => {
                setBusyText("Verbinde mit Discogs …");
                void startLogin(setBusyText);
              }}
            >
              {busyText ? "Einen Moment …" : "Mit Discogs anmelden"}
            </button>
          )}
          <p className="tiny" style={{ marginTop: 12 }}>Du meldest dich direkt bei Discogs an. Crate sieht dein Passwort nie.</p>
          {/* Rückmeldung: bei einem Freund öffnete sich in der App die Tastatur auf der Discogs-Seite nicht. Ausweg: im
              richtigen Chrome anmelden. Die App läuft in Chrome und ist danach ebenfalls angemeldet. */}
          {/* iPhone-App: bekannter Fehler in iOS, die Tastatur erscheint in Home-Bildschirm-Apps manchmal nicht
              (WebKit-Fehler 279904 und 235243). Crate kann das nicht beheben, nur sagen, was hilft. */}
          {iosApp && (
            <p className="tiny login-help" style={{ marginTop: 8 }}>
              Tastatur öffnet sich bei Discogs nicht? Das ist ein Fehler im iPhone bei Apps vom Home-Bildschirm. Crate ganz schließen und neu öffnen. Hilft das nicht: Symbol entfernen, iPhone neu starten und Crate in Safari neu hinzufügen. Solange läuft Crate auch <a href={location.origin} target="_blank" rel="noreferrer">in Safari</a>.
            </p>
          )}
          {android && inApp && !inAppBrowser() && (
            <p className="tiny login-help" style={{ marginTop: 8 }}>
              Tastatur öffnet sich bei Discogs nicht? <a href={openInChromeUrl("/")}>In Chrome anmelden</a>, danach bist du auch hier angemeldet.
            </p>
          )}
          <p className="tiny" style={{ marginTop: 18 }}>
            Daten von{" "}
            <a href="https://www.discogs.com" target="_blank" rel="noreferrer">Discogs</a>,{" "}
            <a href="https://www.deezer.com" target="_blank" rel="noreferrer">Deezer</a> und{" "}
            <a href="https://www.last.fm" target="_blank" rel="noreferrer">Last.fm</a>
          </p>
          <p className="tiny" style={{ marginTop: 8 }}>
            This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.
            <br />
            <a href="/app">App holen</a> · <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Rückkehr von Discogs: Anmeldung abschließen, bei Überlastung selbst neu versuchen */
export function LoginFinish({ token, verifier }: { token: string; verifier: string }) {
  const [text, setText] = useState("Anmeldung wird abgeschlossen …");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeLogin(token, verifier, setText)
      .then(() => {
        // Zurück dorthin, wo ein geteilter Link hinwollte (Freund hinzufügen, Set übernehmen)
        let back = "/";
        try {
          const saved = sessionStorage.getItem("crate:after");
          sessionStorage.removeItem("crate:after");
          if (saved?.startsWith("/") && !saved.startsWith("//")) back = saved;
        } catch {
          /* egal */
        }
        history.replaceState(null, "", back);
        location.reload();
      })
      .catch((e: Error) => setError(e.message));
  }, [token, verifier]);
  return (
    <div className="app" style={{ paddingBottom: 0 }}>
      <div className="empty" style={{ minHeight: "80vh", justifyContent: "center", padding: 24 }}>
        {!error && <span className="spin" style={{ width: 28, height: 28 }} />}
        <b style={{ fontSize: 20 }}>{error ? "Anmeldung nicht abgeschlossen" : "Gleich geht es los"}</b>
        <span className="sub" aria-live="polite">{error ?? text}</span>
        {error && (
          <button
            className="btn primary"
            onClick={() => {
              setError(null);
              setText("Verbinde mit Discogs …");
              void startLogin(setText);
            }}
          >
            Noch einmal anmelden
          </button>
        )}
      </div>
    </div>
  );
}
