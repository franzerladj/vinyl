// Leiste über der Tab-Leiste: was gerade läuft, Pause, Schließen. Antippen oder Hochziehen öffnet den großen Player.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { openFull, stop, toggle, usePlayer, usePlayerTime } from "../lib/player";
import { Cover, haptic, useRootClass, useSwipeDown } from "./bits";
import { IconPause, IconPlay, IconX } from "./icons";

function Progress() {
  const { time, duration } = usePlayerTime();
  return (
    <span className="mp-progress" aria-hidden>
      <i style={{ transform: `scaleX(${duration ? Math.min(1, time / duration) : 0})` }} />
    </span>
  );
}

export function MiniPlayer() {
  const { now, playing, failed, full } = usePlayer();
  const loc = useLocation();
  // Diggen hat einen eigenen Player
  const show = Boolean(now) && loc.pathname !== "/dig";
  useRootClass("has-player", show);
  // Nach unten wischen legt den Player weg (wie Schließen)
  const ref = useRef<HTMLDivElement>(null);
  useSwipeDown(ref, stop, show && !full);
  // Nach oben ziehen öffnet den großen Player
  useEffect(() => {
    const el = ref.current;
    if (!el || !show) return;
    let x0 = 0, y0 = 0, live = false;
    const start = (e: TouchEvent) => {
      live = e.touches.length === 1;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      if (!live) return;
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      if (dy < -22 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        live = false;
        haptic(6);
        openFull();
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
    };
  }, [show]);
  if (!now || !show) return null;
  return (
    <div ref={ref} className={`mini-player no-print${playing ? " on" : ""}`} role="region" aria-label="Wiedergabe">
      <button className="mp-main" onClick={() => (haptic(5), openFull())} aria-label={`Player öffnen: ${now.title}`}>
        <span className="mp-cover">
          <Cover src={now.cover} />
        </span>
        <span className="mp-text">
          <b>{now.title}</b>
          <span>{failed ? "Keine Hörprobe gefunden" : now.artist}</span>
        </span>
      </button>
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
      <Progress />
    </div>
  );
}
