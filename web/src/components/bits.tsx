import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { parseKey, camelotString } from "../../../shared/music";
import type { Release } from "../lib/db";
import { formatLine } from "../lib/format";
import { useStore } from "../lib/store";

/** Camelot-Farben (Mixed-In-Key-Rad) */
const CAMELOT_COLORS = ["#5cf0d2", "#82f59c", "#b4f472", "#e9e066", "#f9c278", "#fda08c", "#fd89a6", "#ed86ce", "#cf8bf2", "#a99cf9", "#7cb5f8", "#56d9f2"];

export function KeyBadge({ k }: { k?: string | null }) {
  const c = parseKey(k);
  if (!c) return k ? <span className="badge">{k}</span> : null;
  return (
    <span className="badge cam" style={{ background: CAMELOT_COLORS[c.num - 1], opacity: c.letter === "A" ? 0.85 : 1 }} title={k ?? ""}>
      {camelotString(c)}
    </span>
  );
}

export function Energy({ v }: { v?: number | null }) {
  if (v == null) return null;
  return (
    <span className="energy-bar" title={`Energie ${v}/10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={v >= i * 2 + 1 ? "on" : ""} />
      ))}
    </span>
  );
}

export function Cover({ src, className = "cover" }: { src?: string; className?: string }) {
  return src ? <img className={className} src={src} loading="lazy" alt="" /> : <div className={className} />;
}

export function RecordRow({ r, side, to }: { r: Release; side?: React.ReactNode; to?: string }) {
  return (
    <Link to={to ?? `/release/${r.id}`} className="rec">
      <Cover src={r.thumb} />
      <div className="rec-main">
        <div className="rec-title">{r.title}</div>
        <div className="rec-artist">{r.artist}</div>
        <div className="rec-meta">
          {r.labels[0] && (
            <span>
              {r.labels[0].name.replace(/\s\(\d+\)$/, "")} · {r.labels[0].catno}
            </span>
          )}
          {r.year ? <span>{r.year}</span> : null}
          <span>{formatLine(r)}</span>
        </div>
      </div>
      {side && <div className="rec-side">{side}</div>}
    </Link>
  );
}

export function Jobs() {
  const jobs = useStore((s) => s.jobs);
  const toastMsg = useStore((s) => s.toast);
  const list = Object.values(jobs);
  return (
    <>
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {list.length > 0 && (
        <div className="jobs">
          {list.map((j) => (
            <div key={j.id} className="job">
              <div className="row">
                <span>{j.label}</span>
                <span className="spacer" />
                <span className="sub">
                  {j.done}/{j.total || "?"}
                </span>
              </div>
              <div className="progress" style={{ marginTop: 6 }}>
                <div style={{ width: `${j.total ? (100 * j.done) / j.total : 5}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">{children}</div>
    </>
  );
}

/** Tap-Tempo: mindestens 4x tippen, Mittelwert der letzten Abstände */
export function TapTempo({ onBpm }: { onBpm: (bpm: number) => void }) {
  const taps = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now].slice(-12);
    if (taps.current.length >= 4) {
      const d = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const avg = d.reduce((a, b) => a + b, 0) / d.length;
      setBpm(Math.round((60000 / avg) * 10) / 10);
    }
  };
  return (
    <div className="row">
      <button className="btn" onPointerDown={tap} style={{ minWidth: 120, minHeight: 56 }}>
        TAP
      </button>
      <b style={{ fontSize: 22 }}>{bpm ?? "–"}</b>
      <span className="sub">BPM</span>
      <span className="spacer" />
      <button className="btn small primary" disabled={!bpm} onClick={() => bpm && onBpm(Math.round(bpm))}>
        Übernehmen
      </button>
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
