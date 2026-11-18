// Großer Player: aus der Leiste hochgezogen. Hülle mit Platte, Spulen, Vor und Zurück, was als Nächstes kommt.
// Nach unten wischen oder Zurück klappt ihn wieder ein, der Ton läuft weiter.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { closeFull, hasNext, next, play, prev, seek, stop, toggle, usePlayer, usePlayerTime } from "../lib/player";
import { camelotString, parseKey } from "../../../shared/music";
import { Cover, haptic, keepParens, useBackClose, useSwipeDown } from "./bits";
import { IconChevron, IconPause, IconPlay, IconX } from "./icons";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const IconPrev = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden>
    <path d="M6 5h2v14H6zM20 5v14L9 12z" />
  </svg>
);
const IconNext = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden>
    <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
  </svg>
);

/** Fortschritt zum Anfassen: Tippen oder Ziehen springt an die Stelle */
function Scrubber() {
  const { time, duration } = usePlayerTime();
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const part = drag ?? (duration ? Math.min(1, time / duration) : 0);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  return (
    <div className="np-scrub">
      <div
        ref={ref}
        className={`np-bar${drag != null ? " drag" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="Stelle in der Hörprobe"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(part * duration)}
        aria-valuetext={clock(part * duration)}
        data-no-swipe
        onPointerDown={(e) => {
          if (!duration) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(at(e));
        }}
        onPointerMove={(e) => drag != null && setDrag(at(e))}
        onPointerUp={(e) => {
          if (drag == null) return;
          seek(at(e));
          setDrag(null);
          haptic(4);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (!duration || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
          e.preventDefault();
          seek((time + (e.key === "ArrowRight" ? 5 : -5)) / duration);
        }}
      >
        <span className="np-track">
          <i style={{ transform: `scaleX(${part})` }} />
        </span>
        <span className="np-rail" style={{ transform: `translateX(${part * 100}%)` }}>
          <span className="np-knob" />
        </span>
      </div>
      <div className="np-times mono">
        <span>{clock(part * duration)}</span>
        <span>{duration ? clock(duration) : "Hörprobe"}</span>
      </div>
    </div>
  );
}

export function NowPlaying() {
  const { now, playing, failed, queue, index, full } = usePlayer();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const open = full && Boolean(now);
  useSwipeDown(ref, closeFull, open);
  useBackClose(open, closeFull);
  const track = useLiveQuery(() => (now?.trackId ? db.tracks.get(now.trackId) : undefined), [now?.trackId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [role=slider]")) return;
      if (e.key === "Escape") closeFull();
      else if (e.key === " ") toggle();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  if (!open || !now) return null;
  const key = parseKey(track?.key);
  const tags = [track?.position, track?.bpm ? `${track.tempoCheck === "unsicher" ? "~" : ""}${Math.round(track.bpm)} BPM` : null, key ? camelotString(key) : null, track?.key && key ? track.key : null].filter(Boolean);
  const upNext = queue.slice(index + 1, index + 9);
  const openRecord = () => {
    closeFull();
    // Erst einklappen (der Verlaufseintrag des Players geht weg), dann zur Platte
    setTimeout(() => nav(`/release/${now.releaseId}`, { viewTransition: true }), 60);
  };
  return createPortal(
    <>
      <div className="np-backdrop" onClick={closeFull} />
      <div ref={ref} className={`np no-print${playing ? " playing" : ""}`} role="dialog" aria-modal="true" aria-label="Wiedergabe">
        <div className="np-top">
          <button className="np-icon" onClick={closeFull} aria-label="Einklappen">
            <span style={{ display: "grid", rotate: "90deg" }}>
              <IconChevron />
            </span>
          </button>
          <span className="np-label mono">{queue.length > 1 ? `Track ${index + 1} von ${queue.length}` : "Hörprobe"}</span>
          <button className="np-icon" onClick={() => (haptic(5), stop())} aria-label="Wiedergabe beenden">
            <IconX />
          </button>
        </div>

        <div className="np-stage">
          <div className="np-deck">
            <div className="np-disc" aria-hidden>
              <span style={now.cover ? { backgroundImage: `url("${now.cover}")` } : undefined} />
            </div>
            <Cover src={now.cover} className="cover np-cover" />
          </div>
        </div>

        <div className="np-meta">
          <h2 className="np-title">{keepParens(now.title)}</h2>
          <p className="np-artist">{failed ? "Keine Hörprobe gefunden" : now.artist}</p>
          {tags.length > 0 && <p className="np-tags mono">{tags.join(" · ")}</p>}
        </div>

        <Scrubber />

        <div className="np-ctl">
          <button className="np-step" onClick={() => (haptic(5), prev())} aria-label="Zurück">
            <IconPrev />
          </button>
          <button className="np-play" onClick={() => (haptic(8), toggle())} aria-label={playing ? "Pause" : "Abspielen"} disabled={failed}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="np-step" onClick={() => (haptic(5), next())} aria-label="Weiter" disabled={!hasNext()}>
            <IconNext />
          </button>
        </div>

        <button className="btn block np-open" onClick={openRecord}>
          Platte öffnen
        </button>

        {upNext.length > 0 && (
          <div className="np-queue">
            <h3>Als Nächstes</h3>
            {upNext.map((q, i) => (
              <button key={q.trackId ?? q.src} className="np-row press" onClick={() => (haptic(5), void play(q))}>
                <span className="mono">{index + 2 + i}</span>
                <span className="np-row-text">
                  <b>{q.title}</b>
                  <em>{q.artist}</em>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
