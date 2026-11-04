import type { Me } from "../lib/api";

export default function Login({ me }: { me: Me | null }) {
  const failed = new URLSearchParams(location.search).get("login") === "failed";
  return (
    <div className="app">
      <div className="hero">
        <img src="/icon.svg" width={84} height={84} style={{ margin: "0 auto" }} alt="" />
        <h1>Crate</h1>
        <p className="sub">Deine Discogs-Sammlung, aufgeräumt für Vinyl-DJs.</p>
        <div className="feature-list">
          <div>
            <b>Wantlist sortieren</b>
            <div className="sub">Nach Preis, Verfügbarkeit, Style, Label und mehr.</div>
          </div>
          <div>
            <b>Versand sparen</b>
            <div className="sub">Findet die Händler, bei denen du die meisten Wants auf einmal bekommst.</div>
          </div>
          <div>
            <b>Setlists nach BPM, Key und Vibe</b>
            <div className="sub">Harmonische Übergänge über das Camelot-Rad, Energie-Kurve fürs Set.</div>
          </div>
          <div>
            <b>Sticker für die Outer Sleeves</b>
            <div className="sub">Artist, Tracks je Seite, BPM, Key, QR-Code. Druckfertig.</div>
          </div>
        </div>
        {failed && <p style={{ color: "var(--bad)" }}>Anmeldung fehlgeschlagen. Bitte noch einmal versuchen.</p>}
        {me?.features.oauth === false ? (
          <p className="sub">Der Server hat keinen Discogs-Consumer-Key. Siehe README, Abschnitt Einrichtung.</p>
        ) : (
          <a className="btn primary block" href="/api/auth/login" style={{ padding: 14 }}>
            Mit Discogs anmelden
          </a>
        )}
      </div>
    </div>
  );
}
