import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { parseKey, camelotString } from "../../../shared/music";
import type { Release } from "../lib/db";
import { useStore } from "../lib/store";

/** Kurzes haptisches Feedback (Android; iOS-Safari ignoriert es) */
export const haptic = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* nicht unterstützt */
  }
};

/** Camelot-Farben (Mixed-In-Key-Rad) */
export const CAMELOT_COLORS = ["#5cf0d2", "#82f59c", "#b4f472", "#e9e066", "#f9c278", "#fda08c", "#fd89a6", "#ed86ce", "#cf8bf2", "#a99cf9", "#7cb5f8", "#56d9f2"];
export const camelotColor = (k?: string | null) => {
  const c = parseKey(k);
  return c ? CAMELOT_COLORS[c.num - 1] : null;
};

export function KeyBadge({ k }: { k?: string | null }) {
  const c = parseKey(k);
  if (!c) return k ? <span className="badge">{k}</span> : null;
  return (
    <span className="badge cam" style={{ background: CAMELOT_COLORS[c.num - 1], opacity: c.letter === "A" ? 0.88 : 1 }} title={k ?? ""}>
      {camelotString(c)}
    </span>
  );
}

export function Energy({ v }: { v?: number | null }) {
  if (v == null) return null;
  return (
    <span className="energy-bar" title={`Energie ${v}/10`} aria-label={`Energie ${v} von 10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={v >= i * 2 + 1 ? "on" : ""} />
      ))}
    </span>
  );
}

export function Cover({ src, className = "cover", style }: { src?: string; className?: string; style?: React.CSSProperties }) {
  const [ok, setOk] = useState(true);
  return src && ok ? <img className={className} src={src} loading="lazy" decoding="async" alt="" style={style} onError={() => setOk(false)} /> : <div className={className} style={style} />;
}

/** Vorschau-Daten, die beim Antippen an die Detailseite übergeben werden (für die Cover-Animation) */
export interface Preview {
  thumb?: string;
  cover?: string;
  title?: string;
  artist?: string;
}

/** Name für die gemeinsame Cover-Animation nur am angetippten Element setzen */
export function markHero(el: HTMLElement) {
  document.querySelectorAll<HTMLElement>("[data-hero]").forEach((n) => (n.style.viewTransitionName = ""));
  const c = el.querySelector<HTMLElement>(".cover");
  if (c) {
    c.style.viewTransitionName = "hero-cover";
    c.dataset.hero = "1";
  }
}

export function RecordRow({ r, side, to }: { r: Release; side?: React.ReactNode; to?: string }) {
  const label = r.labels[0];
  return (
    <Link
      to={to ?? `/release/${r.id}`}
      state={{ preview: { thumb: r.thumb, cover: r.cover, title: r.title, artist: r.artist } satisfies Preview }}
      viewTransition
      className="rec"
      onClick={(e) => {
        markHero(e.currentTarget);
        haptic();
      }}
    >
      <Cover src={r.thumb} />
      <div className="rec-main">
        <div className="rec-title">{r.title}</div>
        <div className="rec-artist">{r.artist}</div>
        <div className="rec-meta">
          {label && <span>{label.name.replace(/\s\(\d+\)$/, "")}</span>}
          {label?.catno && label.catno !== "none" && <span>{label.catno}</span>}
          {r.year ? <span>{r.year}</span> : null}
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
      {toastMsg && (
        <div className="toast" role="status" key={toastMsg}>
          {toastMsg}
        </div>
      )}
      {list.length > 0 && (
        <div className="jobs" aria-live="polite">
          {list.map((j) => (
            <div key={j.id} className="job">
              <div className="row">
                <span>{j.label}</span>
                <span className="spacer" />
                <span className="sub" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {j.done}/{j.total || "?"}
                </span>
              </div>
              <div className="progress">
                <div style={{ width: `${j.total ? (100 * j.done) / j.total : 4}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Bottom-Sheet mit Griff, Feder-Animation und Wischen nach unten zum Schließen */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const end = () => {
    if (!drag.current || !ref.current) return;
    const el = ref.current;
    if (drag.current.dy > 110) {
      el.style.transition = "transform .25s var(--ease)";
      el.style.transform = "translateY(100%)";
      setTimeout(onClose, 220);
    } else {
      el.style.transition = "transform .45s var(--spring)";
      el.style.transform = "";
      setTimeout(() => (el.style.transition = ""), 460);
    }
    drag.current = null;
  };
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" ref={ref} role="dialog" aria-modal="true">
        <div
          className="sheet-grab"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, dy: 0 };
          }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <div className="sheet-handle" />
        </div>
        {children}
      </div>
    </>
  );
}

/** Tap-Tempo: mindestens 4x tippen, Mittelwert der letzten Abstände */
export function TapTempo({ onBpm }: { onBpm: (bpm: number) => void }) {
  const taps = useRef<number[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const tap = () => {
    haptic(6);
    setPulse((p) => p + 1);
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now].slice(-12);
    if (taps.current.length >= 4) {
      const d = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const avg = d.reduce((a, b) => a + b, 0) / d.length;
      setBpm(Math.round((60000 / avg) * 10) / 10);
    }
  };
  return (
    <div className="card row" style={{ background: "var(--surface-2)" }}>
      <button
        key={pulse}
        className="btn primary"
        onPointerDown={tap}
        style={{ width: 76, height: 76, flex: "none", padding: 0, borderRadius: "50%", fontWeight: 800, animation: pulse ? "pop .35s var(--spring)" : undefined }}
        aria-label="Im Takt tippen"
      >
        TAP
      </button>
      <div>
        <div className="bpm" style={{ fontSize: 30 }}>{bpm ?? "–"}</div>
        <div className="sub">{taps.current.length < 4 ? "Mind. 4x im Takt tippen" : "BPM"}</div>
      </div>
      <span className="spacer" />
      <button className="btn small tinted" disabled={!bpm} onClick={() => bpm && onBpm(Math.round(bpm))}>
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

/** iOS-Segmented-Control mit gleitendem Indikator */
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const i = options.findIndex(([v]) => v === value);
      const btn = ref.current?.querySelectorAll("button")[i];
      if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [value, options]);
  return (
    <div className="seg" ref={ref} role="tablist">
      {thumb && <span className="seg-thumb" style={thumb} />}
      {options.map(([v, l]) => (
        <button
          key={v}
          role="tab"
          aria-selected={v === value}
          onClick={() => {
            haptic(5);
            onChange(v);
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Fortschrittsring */
export function Ring({ value, max, size = 64, color = "var(--accent)", children }: { value: number; max: number; size?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = max ? Math.min(1, value / max) : 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg className="ring" width={size} height={size}>
        <circle className="bgc" cx={size / 2} cy={size / 2} r={r} />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} stroke={color} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700 }}>{children}</div>
    </div>
  );
}

/** Platte als Illustration für Leerzustände */
export function Disc() {
  return (
    <svg className="disc" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" fill="var(--surface-2)" />
      {[40, 34, 28].map((r) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="0.8" />
      ))}
      <circle cx="50" cy="50" r="16" fill="var(--accent)" />
      <circle cx="50" cy="50" r="2.5" fill="var(--bg)" />
    </svg>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <Disc />
      <b>{title}</b>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row" style={{ padding: "9px 0", gap: 14 }}>
          <div className="skel" style={{ width: 56, height: 56 }} />
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ height: 14, width: "60%", marginBottom: 8 }} />
            <div className="skel" style={{ height: 12, width: "40%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Preis-Ampel */
export function DealDot({ a }: { a: "green" | "yellow" | "red" | "unknown" }) {
  if (a === "unknown") return null;
  const c = a === "green" ? "var(--ok)" : a === "yellow" ? "var(--warn)" : "var(--bad)";
  const t = a === "green" ? "unter Marktwert" : a === "yellow" ? "fairer Preis" : "über Marktwert";
  return <span className="dot" style={{ background: c, width: 9, height: 9 }} title={t} aria-label={t} />;
}

/** Mini-Verlaufskurve */
export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  const v = values.filter((x) => x > 0);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * width},${height - 3 - ((x - lo) / (hi - lo || 1)) * (height - 6)}`).join(" ");
  const down = v[v.length - 1] < v[0];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={down ? "var(--ok)" : "var(--accent)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
