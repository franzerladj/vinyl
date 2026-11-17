// Leiste über der Tab-Leiste: was gerade läuft, Pause, Schließen. Antippen öffnet die Platte.
import { Link, useLocation } from "react-router-dom";
import { stop, toggle, usePlayer } from "../lib/player";
import { Cover, haptic, useRootClass } from "./bits";
import { IconPause, IconPlay, IconX } from "./icons";

export function MiniPlayer() {
  const { now, playing, failed } = usePlayer();
  const loc = useLocation();
  // Diggen hat einen eigenen Player
  const show = Boolean(now) && loc.pathname !== "/dig";
  useRootClass("has-player", show);
  if (!now || !show) return null;
  return (
    <div className={`mini-player no-print${playing ? " on" : ""}`} role="region" aria-label="Wiedergabe">
      <Link to={`/release/${now.releaseId}`} viewTransition className="mp-main">
        <span className="mp-cover">
          <Cover src={now.cover} />
        </span>
        <span className="mp-text">
          <b>{now.title}</b>
          <span>{failed ? "Keine Hörprobe gefunden" : now.artist}</span>
        </span>
      </Link>
      <button
        className="mp-btn"
        onClick={() => {
          haptic(6);
          toggle();
        }}
        aria-label={playing ? "Pause" : "Abspielen"}
        disabled={failed}
      >
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <button className="mp-btn sub" onClick={stop} aria-label="Wiedergabe beenden">
        <IconX />
      </button>
    </div>
  );
}
