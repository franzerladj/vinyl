import { useEffect, useState } from "react";
import type { Me } from "../lib/api";
import { completeLogin, startLogin } from "../lib/auth";
import { IconCart, IconList, IconSearch, IconTag } from "../components/icons";

const SLEEVES = [
  { bg: "linear-gradient(135deg,#ff9a3c,#ff3d00)", x: 18, y: 40, r: -12 },
  { bg: "linear-gradient(135deg,#7c3aed,#c084fc)", x: 190, y: 30, r: 10 },
  { bg: "linear-gradient(135deg,#0ea5e9,#22d3ee)", x: 104, y: 92, r: -2 },
];

export default function Login({ me }: { me: Me | null }) {
  const status = new URLSearchParams(location.search).get("login");
  const [busyText, setBusyText] = useState<string | null>(null);
  return (
    <div className="app" style={{ paddingBottom: 0 }}>
      <div className="hero">
        <div className="hero-art" aria-hidden="true">
          {SLEEVES.map((s, i) => (
            <div
              key={i}
              className="c"
              style={{ left: s.x, top: s.y, background: s.bg, rotate: `${s.r}deg`, animation: `rise .9s var(--spring) ${0.1 + i * 0.12}s both` }}
            >
              <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", opacity: 0.25 }}>
                <circle cx="50" cy="50" r="30" fill="none" stroke="#fff" strokeWidth="1.2" />
                <circle cx="50" cy="50" r="6" fill="#fff" />
              </svg>
            </div>
          ))}
        </div>
        <h1>Crate</h1>
        <p className="sub" style={{ fontSize: 17, margin: 0 }}>Deine Discogs-Sammlung, gebaut für Vinyl-DJs.</p>
        <div className="feature-list">
          {[
            [IconSearch, "Wantlist, die man gern benutzt", "Sortieren nach Preis, Angeboten, Style, Label."],
            [IconCart, "Weniger Versand zahlen", "Findet die Händler mit den meisten deiner Wants."],
            [IconList, "Sets nach BPM, Key und Vibe", "Harmonische Übergänge, Energie-Kurve, Einpackliste."],
            [IconTag, "Sticker & Einleger", "Tracks, BPM und Key, von außen lesbar."],
          ].map(([Icon, t, d], i) => {
            const I = Icon as typeof IconSearch;
            return (
              <div key={i} style={{ animation: `rise .6s var(--ease) ${0.35 + i * 0.07}s both` }}>
                <span className="ico">
                  <I />
                </span>
                <div>
                  <b>{t as string}</b>
                  <span className="sub">{d as string}</span>
                </div>
              </div>
            );
          })}
        </div>
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
