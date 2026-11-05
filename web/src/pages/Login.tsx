import { useEffect, useState } from "react";
import type { Me } from "../lib/api";
import { completeLogin, startLogin } from "../lib/auth";
import { LogoMark, Wordmark } from "../components/Logo";

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
  return (
    <div className="app" style={{ paddingBottom: 0 }}>
      <div className="hero">
        <div className="login-mark">
          <LogoMark size={168} animate />
        </div>
        <Wordmark className="login-word" />
        <p className="login-claim">Für Leute, die Platten auflegen.</p>
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
          <p className="tiny" style={{ marginTop: 18 }}>
            Daten von{" "}
            <a href="https://www.discogs.com" target="_blank" rel="noreferrer">Discogs</a>,{" "}
            <a href="https://www.deezer.com" target="_blank" rel="noreferrer">Deezer</a>,{" "}
            <a href="https://www.last.fm" target="_blank" rel="noreferrer">Last.fm</a> und{" "}
            <a href="https://getsongbpm.com" target="_blank" rel="noreferrer">GetSongBPM</a>
          </p>
          <p className="tiny" style={{ marginTop: 8 }}>
            Nutzt die Discogs-API, ist aber nicht mit Discogs verbunden oder von Discogs unterstützt.
            <br />
            <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a>
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
