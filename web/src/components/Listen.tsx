// Mithören: Platte läuft, Handy hört zu und misst BPM und Key auf dem Gerät.
import { useEffect, useRef, useState } from "react";
import type { AnalysisHints } from "../../../shared/audioAnalysis";
import type { ReadState, Summary } from "../../../shared/listen";
import { canListen, startListening, type ListenError } from "../lib/listen";
import { haptic, KeyBadge } from "./bits";
import { IconMic } from "./icons";

const ERRORS: Record<ListenError, string> = {
  denied: "Kein Zugriff aufs Mikrofon. Erlaube es in den Einstellungen deines Browsers für Crate und versuch es noch einmal.",
  nomic: "Kein Mikrofon gefunden.",
  unsupported: "Dieser Browser kann leider nicht mithören.",
};

const STATE: Record<ReadState, string> = { listening: "hört zu …", unsure: "noch unsicher", stable: "steht" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Listen({ hints, onTake, takeLabel = "Übernehmen" }: { hints: AnalysisHints; onTake: (bpm: number | null, key: string | null) => void; takeLabel?: string }) {
  const [phase, setPhase] = useState<"idle" | "starting" | "on" | "off">("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [sum, setSum] = useState<Summary | null>(null);
  const [factor, setFactor] = useState(1);
  const [quiet, setQuiet] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const quietSince = useRef<number | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = () => {
    haptic(8);
    setError(null);
    setSum(null);
    setSeconds(0);
    setFactor(1);
    setQuiet(false);
    quietSince.current = null;
    setPhase("starting");
    startListening(hints, (u) => {
      setSeconds(u.seconds);
      setSum(u.summary);
      if (ring.current) ring.current.style.transform = `scale(${1 + u.level * 0.22})`;
      // Länger als 3 s fast nichts zu hören: Hinweis zeigen
      if (u.level < 0.18) {
        quietSince.current ??= u.seconds;
        setQuiet(u.seconds - quietSince.current > 3);
      } else {
        quietSince.current = null;
        setQuiet(false);
      }
      if (u.done) {
        stopRef.current = null;
        if (ring.current) ring.current.style.transform = "";
        setPhase("off");
        haptic(14);
      }
    })
      .then((stop) => {
        stopRef.current = stop;
        setPhase((p) => (p === "starting" ? "on" : p));
      })
      .catch((e: Error) => {
        setError(ERRORS[e.message as ListenError] ?? ERRORS.nomic);
        setPhase("idle");
      });
  };

  const stop = () => {
    haptic(6);
    stopRef.current?.();
    stopRef.current = null;
    if (ring.current) ring.current.style.transform = "";
    setPhase("off");
  };

  if (!canListen()) return null;

  const listening = phase === "on" || phase === "starting";
  const bpm = sum?.bpm ? Math.round(sum.bpm * factor * 10) / 10 : null;
  const hasResult = !!(bpm || sum?.key);
  const status = error
    ? null
    : phase === "idle"
      ? "Platte auflegen, Pitch auf\u00a00, Handy zur Box halten."
      : quiet && listening
        ? "Kaum etwas zu hören. Näher an die Box oder lauter drehen."
        : listening && seconds < 8
          ? "Hört zu. Die erste Messung kommt nach 8 Sekunden."
          : null;

  return (
    <div className={`listen card${listening ? " on" : ""}`}>
      <button className="listen-btn" onClick={listening ? stop : start} aria-label={listening ? "Mithören beenden" : "Mithören"} aria-pressed={listening}>
        <span ref={ring} className="listen-ring" aria-hidden />
        {listening ? <b className="mono">{clock(seconds)}</b> : <IconMic />}
        <small>{listening ? "Stopp" : "Mithören"}</small>
      </button>
      <div className="listen-info">
        {phase === "idle" && !error ? (
          <>
            <b>BPM & Key mithören</b>
            <span className="tiny">{status} Gemessen wird auf dem Gerät, nichts wird gespeichert oder hochgeladen.</span>
          </>
        ) : error ? (
          <span className="tiny" style={{ color: "var(--bad)" }}>{error}</span>
        ) : (
          <>
            <div className="listen-row">
              <span className="tap-bpm">{bpm ? bpm.toFixed(1).replace(".", ",") : "–"}</span>
              <small className="sub">BPM {sum && sum.bpm ? STATE[sum.bpmState] : listening ? STATE.listening : ""}</small>
            </div>
            <div className="listen-row">
              {sum?.key ? <KeyBadge k={sum.key} /> : <span className="tap-bpm small">–</span>}
              {sum?.key && <b>{sum.key}</b>}
              <small className="sub">Key {sum && sum.key ? STATE[sum.keyState] : listening ? STATE.listening : ""}</small>
            </div>
            {status && <span className="tiny">{status}</span>}
            {phase === "off" && bpm && (
              <div className="tap-tools">
                <button onClick={() => setFactor((f) => f / 2)} aria-label="Halbes Tempo">÷2</button>
                <button onClick={() => setFactor((f) => f * 2)} aria-label="Doppeltes Tempo">×2</button>
              </div>
            )}
          </>
        )}
      </div>
      {phase === "off" && (
        <button
          className="btn small primary tap-take"
          disabled={!hasResult}
          onClick={() => {
            haptic(10);
            onTake(bpm ? Math.round(bpm * 10) / 10 : null, sum?.key ?? null);
            setPhase("idle");
            setSum(null);
          }}
        >
          {hasResult ? takeLabel : "Nichts erkannt"}
        </button>
      )}
    </div>
  );
}
