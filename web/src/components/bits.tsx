import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { parseKey, camelotString } from "../../../shared/music";
import type { Release } from "../lib/db";
import { useStore } from "../lib/store";
import { hapticsEnabled } from "../lib/theme";
import { estimateTapTempo, type TapResult } from "../../../shared/tap";

// iOS kennt navigator.vibrate nicht. Safari ab iOS 18 gibt aber beim Umlegen eines System-Schalters
// (<input type="checkbox" switch>) ein spürbares Tick. Ein unsichtbarer Schalter liefert so echtes Feedback.
let iosSwitch: HTMLLabelElement | null = null;
const isIOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent) && !("vibrate" in navigator);
function iosTick() {
  if (!iosSwitch) {
    iosSwitch = document.createElement("label");
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

/** Kurzes haptisches Feedback (Android über vibrate, iPhone über den Schalter-Trick) */
export const haptic = (ms = 8) => {
  if (!hapticsEnabled()) return;
  try {
    if (isIOS) iosTick();
    else navigator.vibrate?.(ms);
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
      data-key={`r${r.id}`}
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

/** Schalter am <html>: ersetzt teure :has()-Regeln (die bei jeder Änderung den ganzen Baum prüfen) */
export function useRootClass(name: string, on: boolean) {
  useEffect(() => {
    if (!on) return;
    document.documentElement.classList.add(name);
    return () => document.documentElement.classList.remove(name);
  }, [name, on]);
}

export function Jobs() {
  const jobs = useStore((s) => s.jobs);
  const loc = useLocation();
  const toastMsg = useStore((s) => s.toast);
  const update = useStore((s) => s.updateReady);
  const list = Object.values(jobs);
  const showJobs = list.length > 0 && loc.pathname !== "/" && loc.pathname !== "/scan";
  useRootClass("has-jobs", showJobs);
  return (
    <>
      <AskDialog />
      {update && list.length === 0 && (
        <button className="toast" style={{ border: 0, cursor: "pointer", animation: "island .55s var(--spring) both" }} onClick={() => update()}>
          Neue Version da · Tippen zum Aktualisieren
        </button>
      )}
      {toastMsg && (
        <div className="toast" role="status" key={toastMsg}>
          {toastMsg}
        </div>
      )}
      {showJobs && (
        <div className="jobs" aria-live="polite">
          {(() => {
            const done = list.reduce((a, j) => a + j.done, 0);
            const total = list.reduce((a, j) => a + (j.total || 0), 0);
            const pct = total ? Math.min(100, (100 * done) / total) : 6;
            return (
              <Link to="/settings/sync" className="job-pill press" aria-label="Sync-Status">
                <svg viewBox="0 0 20 20" width="18" height="18" style={{ flex: "none" }}>
                  <circle cx="10" cy="10" r="8" fill="none" stroke="var(--surface-3)" strokeWidth="2.5" />
                  <circle cx="10" cy="10" r="8" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 50.3} 50.3`} transform="rotate(-90 10 10)" />
                </svg>
                <span className="job-label">{list[0].label}</span>
                <span className="sub" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {list[0].done}/{list[0].total || "?"}
                </span>
                {list.length > 1 && <span className="badge">+{list.length - 1}</span>}
              </Link>
            );
          })()}
        </div>
      )}
    </>
  );
}

/**
 * Wischen nach unten schließt ein Blatt, egal wo man es anfasst. Ist der Inhalt gescrollt,
 * scrollt die Geste zuerst nach oben; erst am Anfang zieht sie das Blatt mit (wie in iOS).
 */
export function useSwipeDown(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let y0 = 0, x0 = 0, dy = 0, lastY = 0, lastT = 0, v = 0;
    let state: "idle" | "maybe" | "drag" = "idle";
    /** Liegt zwischen Finger und Blatt etwas Gescrolltes, gehört die Geste dem Scrollen */
    const scrolled = (t: HTMLElement | null) => {
      for (let n = t; n; n = n.parentElement) {
        if (n.scrollTop > 0) return true;
        if (n === el) break;
      }
      return false;
    };
    const start = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      if (e.touches.length !== 1 || t.closest("input[type=range], textarea, [data-no-swipe]") || scrolled(t)) {
        state = "idle";
        return;
      }
      state = "maybe";
      y0 = lastY = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      lastT = performance.now();
      dy = v = 0;
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const t = e.touches[0];
      if (state === "maybe") {
        const my = t.clientY - y0, mx = t.clientX - x0;
        if (Math.abs(my) < 8 && Math.abs(mx) < 8) return;
        if (my <= 0 || Math.abs(mx) > my || scrolled(e.target as HTMLElement)) {
          state = "idle";
          return;
        }
        state = "drag";
        y0 = t.clientY;
        el.style.transition = "none";
      }
      const now = performance.now();
      v = v * 0.6 + ((t.clientY - lastY) / Math.max(1, now - lastT)) * 0.4;
      lastY = t.clientY;
      lastT = now;
      dy = Math.max(0, t.clientY - y0);
      el.style.transform = `translate3d(0,${dy}px,0)`;
    };
    const end = () => {
      if (state !== "drag") {
        state = "idle";
        return;
      }
      state = "idle";
      if (dy > 110 || (v > 0.5 && dy > 30)) {
        el.style.transition = "transform .24s cubic-bezier(.32,.72,0,1)";
        el.style.transform = "translate3d(0,100%,0)";
        setTimeout(() => close.current(), 210);
      } else {
        el.style.transition = "transform .45s var(--spring)";
        el.style.transform = "";
        setTimeout(() => (el.style.transition = ""), 460);
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** Bottom-Sheet mit Griff, Feder-Animation und Wischen nach unten zum Schließen (überall am Blatt) */
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
  useSwipeDown(ref, onClose, open);
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
            if (e.pointerType === "touch") return;
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
/**
 * Tap-Tempo: Gerade durch alle Tipps statt Mittelwert der Abstände, verpasste Schläge zählen mit.
 * Danach blinkt der Ring im gemessenen Tempo weiter, so lässt sich das Ergebnis gegen die Musik prüfen.
 */
export function TapTempo({ onBpm }: { onBpm: (bpm: number) => void }) {
  const taps = useRef<number[]>([]);
  const [res, setRes] = useState<TapResult | null>(null);
  const [factor, setFactor] = useState(1);
  const btn = useRef<HTMLButtonElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const resRef = useRef<TapResult | null>(null);
  resRef.current = res;

  const register = (t: number) => {
    haptic(6);
    const last = taps.current.at(-1);
    // Lange Pause: neue Messung
    if (last != null && t - last > 4000) {
      taps.current = [];
      setFactor(1);
    }
    taps.current = [...taps.current, t].slice(-48);
    setRes(estimateTapTempo(taps.current));
    const b = btn.current;
    if (b) {
      b.classList.remove("hit");
      void b.offsetWidth;
      b.classList.add("hit");
    }
  };

  // Ring blinkt im gemessenen Tempo, phasengleich zum letzten Tipp
  useEffect(() => {
    let raf = 0;
    let lastBeat = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = resRef.current;
      const last = taps.current.at(-1);
      if (!r || last == null || r.taps < 4 || !ring.current) return;
      const period = 60000 / r.bpm;
      // Erst blinken, wenn nicht mehr getippt wird. Während des Tippens würde man sonst
      // unbewusst dem Blinken folgen statt der Musik, und das Tempo rutscht nach unten.
      const beat = Math.floor((performance.now() - last) / period);
      if (beat !== lastBeat && beat >= 2) {
        lastBeat = beat;
        ring.current.classList.remove("beat");
        void ring.current.offsetWidth;
        ring.current.classList.add("beat");
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const reset = () => {
    taps.current = [];
    setRes(null);
    setFactor(1);
  };
  const bpm = res ? res.bpm * factor : null;
  const err = res ? res.error * factor : null;
  const n = res?.taps ?? taps.current.length;
  // Genauigkeit als Fortschritt: ±3 BPM = leer, ±0,3 BPM = voll
  const quality = err == null || n < 4 ? Math.min(0.25, n * 0.06) : Math.max(0.08, Math.min(1, (3 - err) / 2.7));
  const status = !res || n < 4 ? `Im Takt tippen${n ? ` (${n})` : ""}` : res.drift ? (res.drift < 0 ? "Du wirst langsamer" : "Du wirst schneller") : err! > 1.5 ? "Weiter tippen …" : err! > 0.5 ? "Fast genau" : "Genau";

  return (
    <div className="tap card">
      <button
        ref={btn}
        className="tap-btn"
        onPointerDown={(e) => {
          e.preventDefault();
          register(e.timeStamp || performance.now());
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (!e.repeat) register(e.timeStamp || performance.now());
          }
        }}
        aria-label="Im Takt tippen"
      >
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" className="tap-track" />
          <circle cx="50" cy="50" r="46" className="tap-progress" strokeDasharray={`${quality * 289} 289`} />
        </svg>
        <span ref={ring} className="tap-ring" />
        <b>TAP</b>
      </button>
      <div className="tap-info">
        <div className="tap-bpm">
          {bpm ? bpm.toFixed(1).replace(".", ",") : "–"}
          {err != null && n >= 4 && <small> ±{err < 0.1 ? "0,1" : err.toFixed(1).replace(".", ",")}</small>}
        </div>
        <div className={`tap-status${err != null && err <= 0.5 && n >= 4 ? " ok" : ""}`}>{status}</div>
        <div className="tap-tools">
          <button onClick={() => setFactor((f) => f / 2)} disabled={!bpm} aria-label="Halbes Tempo">
            ÷2
          </button>
          <button onClick={() => setFactor((f) => f * 2)} disabled={!bpm} aria-label="Doppeltes Tempo">
            ×2
          </button>
          <button onClick={reset} disabled={!n}>
            Neu
          </button>
        </div>
      </div>
      <button className="btn small primary tap-take" disabled={!bpm || n < 4} onClick={() => bpm && onBpm(Math.round(bpm))}>
        {bpm && n >= 4 ? `${Math.round(bpm)} übernehmen` : "Übernehmen"}
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
  // Alle Felder sind gleich breit: der Schieber wird nur verschoben, nichts wird vermessen.
  // (Messen zwang den Browser, die ganze neue Seite mitten im Seitenwechsel durchzurechnen.)
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="seg" role="tablist" style={{ "--seg-n": options.length } as React.CSSProperties}>
      <span className="seg-thumb" style={{ transform: `translateX(${i * 100}%)` }} />
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

/** Profilbild mit Buchstaben als Ersatz */
export function Avatar({ src, name, size = 52 }: { src?: string; name: string; size?: number }) {
  const [ok, setOk] = useState(true);
  return src && ok ? (
    <img src={src} alt="" onError={() => setOk(false)} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--surface-2)" }} />
  ) : (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}


/**
 * Titel umbrechen, ohne eine Klammer zu zerreißen: „Titel (Extended Mix)“ bricht vor der Klammer,
 * nicht mitten darin. Sehr lange Klammern (über 40 Zeichen) dürfen weiter brechen, sonst liefen sie über.
 */
export function keepParens(text: string | null | undefined): React.ReactNode {
  if (!text || !/[([]/.test(text)) return text ?? "";
  return text.split(/(\([^()]*\)|\[[^[\]]*\])/).map((part, i) =>
    /^[([]/.test(part) && part.length <= 40 ? (
      <span key={i} className="nobr">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Rückfrage im Crate-Stil (ersetzt confirm/prompt des Browsers) */
function AskDialog() {
  const a = useStore((s) => s.ask);
  const [text, setText] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!a) return;
    setText(a.input?.value ?? "");
    haptic(8);
    setTimeout(() => (a.input ? inputRef.current?.focus() : okRef.current?.focus()), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        a.resolve(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [a]);
  if (!a) return null;
  const confirmIt = () => (a.input ? text.trim() && a.resolve(text.trim()) : a.resolve(""));
  return (
    <div className="ask-backdrop" onClick={() => a.resolve(null)}>
      <form
        className="ask"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          confirmIt();
        }}
      >
        <b id="ask-title" className="ask-title">
          {a.title}
        </b>
        {a.body && <p className="ask-body">{a.body}</p>}
        {a.input && <input ref={inputRef} className="input" value={text} placeholder={a.input.placeholder} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />}
        <div className="ask-actions">
          <button type="button" className="btn tinted" onClick={() => a.resolve(null)}>
            {a.cancel ?? "Abbrechen"}
          </button>
          <button ref={okRef} type="submit" className={`btn ${a.danger ? "danger" : "primary"}`} disabled={Boolean(a.input) && !text.trim()}>
            {a.ok ?? "Okay"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Pflicht laut Discogs-API-Bedingungen: „Data provided by Discogs.“ direkt bei den Daten,
 * mit Link auf die Discogs-Seite dieser Daten (ohne nofollow).
 */
export function DiscogsCredit({ href, className = "" }: { href: string; className?: string }) {
  return (
    <p className={`discogs-credit ${className}`} lang="en">
      <a href={href} target="_blank" rel="noopener">
        Data provided by Discogs.
      </a>
    </p>
  );
}
