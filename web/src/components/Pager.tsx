import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { haptic, inHorizontalScroller, overlayOpen, Seg } from "./bits";
import { neighborTab } from "../lib/tabSwipe";

/**
 * Zwei Seiten nebeneinander, wie ein nativer Pager: der Umschalter bleibt stehen, sein Schieber folgt
 * dem Finger, und nur der Inhalt gleitet. Die Nachbarseite liegt fertig gerechnet daneben
 * (content-visibility: hidden hält ihren Zustand), deshalb kommt sie beim Wischen ohne Nachladen mit.
 *
 * Ruhezustand: aktive Seite im Fluss, ohne transform (feste und klebende Elemente verhalten sich normal).
 * Beim Wischen: beide Seiten bekommen transform, die Nachbarseite liegt absolut daneben. Feste Elemente
 * einer Seite (Kamera-Knopf, Buchstabenleiste) hängen in einer eigenen festen Ebene, die mitgleitet.
 */

type PaneInfo = {
  index: number;
  active: boolean;
  heads: boolean;
  head: HTMLElement | null;
  fixed: HTMLElement | null;
};
const PaneCtx = createContext<PaneInfo | null>(null);
export const usePane = () => useContext(PaneCtx);

/** Kopf einer Seite: im Pager im gemeinsamen Kopfbereich (blendet beim Wischen über), sonst an Ort und Stelle */
export function PaneHead({ children }: { children: React.ReactNode }) {
  const p = usePane();
  if (!p || !p.heads) return <>{children}</>;
  return p.head ? createPortal(children, p.head) : null;
}

/** Feste Elemente einer Seite: im Pager in einer festen Ebene, die beim Wischen mitgleitet */
export function PaneFixed({ children }: { children: React.ReactNode }) {
  const p = usePane();
  if (!p) return <>{children}</>;
  return p.fixed ? createPortal(children, p.fixed) : null;
}

const EASE = "cubic-bezier(.32,.72,0,1)";
// Waagerecht scrollbare Leisten, Eingaben und Blätter behalten ihr eigenes Wischen
const SKIP =
  ".carousel, .toolbar-row, .folder-tabs, .chips-scroll, .seg, .sheet, .sheet-backdrop, [role=dialog], .alpha-index, input, textarea, select, nav, .nav, .side, .topbar, .mini-player, .jobs, .fab, [data-no-pager]";

export function Pager({
  index,
  onIndex,
  labels,
  children,
  heads = false,
  switchClass = "lib-switch",
}: {
  index: number;
  onIndex: (i: number) => void;
  labels: string[];
  children: React.ReactNode[];
  heads?: boolean;
  switchClass?: string;
}) {
  const [idx, setIdx] = useState(index);
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const n = children.length;
  const [mounted, setMounted] = useState<boolean[]>(() =>
    children.map((_, i) => i === index),
  );
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  // Plätze für Köpfe und feste Ebenen je Seite (stabile ref-Funktionen, sonst ruft React sie bei jedem Rendern)
  const [headEls, setHeadEls] = useState<(HTMLElement | null)[]>([]);
  const [fixEls, setFixEls] = useState<(HTMLElement | null)[]>([]);
  const slotRefs = useMemo(() => {
    const make = (set: typeof setHeadEls) =>
      Array.from({ length: n }, (_, i) => (el: HTMLElement | null) =>
        set((cur) => {
          if (cur[i] === el) return cur;
          const next = [...cur];
          next[i] = el;
          return next;
        }),
      );
    return { head: make(setHeadEls), fixed: make(setFixEls) };
  }, [n]);
  const wrap = useRef<HTMLDivElement>(null);
  const pager = useRef<HTMLDivElement>(null);
  const sw = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const goRef = useRef<(to: number) => void>(() => undefined);
  const onIndexRef = useRef(onIndex);
  onIndexRef.current = onIndex;

  // Adresse oder Eltern ändern die Seite (Seitenleiste, Zurück): ohne Animation übernehmen
  useEffect(() => {
    if (index !== idxRef.current && !busy.current) {
      setMounted((m) => (m[index] ? m : m.map((x, i) => x || i === index)));
      setIdx(index);
    }
  }, [index]);

  // Nachbarseite im Leerlauf vorbereiten (unterbrechbar, blockiert keine Eingaben)
  useEffect(() => {
    const run = () =>
      startTransition(() => setMounted((m) => m.map(() => true)));
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const root = wrap.current;
    const box = pager.current;
    if (!root || !box) return;
    const panes = () =>
      [...box.children].filter(
        (n): n is HTMLElement =>
          n instanceof HTMLElement && n.classList.contains("pager-pane"),
      );
    // Köpfe und feste Ebenen stehen im DOM mit der sichtbaren Seite zuerst: nach data-i ordnen
    const byIndex = (sel: string) => {
      const out: HTMLElement[] = [];
      for (const el of root.querySelectorAll<HTMLElement>(sel)) out[Number(el.dataset.i)] = el;
      return out;
    };
    const heads = () => byIndex(":scope > .pager-heads > .pager-head");
    const fixed = () => byIndex(":scope > .pager-fixed");
    const thumb = () =>
      sw.current?.querySelector<HTMLElement>(".seg-thumb") ?? null;

    let state: "idle" | "maybe" | "drag" | "band" = "idle";
    let from = 0,
      to = 1,
      x0 = 0,
      y0 = 0,
      t0 = 0,
      dx = 0,
      lastX = 0,
      lastT = 0,
      vx = 0;
    let W = 1,
      off = 0;
    let suppressClick = -Infinity;

    const all = () =>
      [...panes(), ...fixed(), ...heads(), thumb()].filter(
        Boolean,
      ) as HTMLElement[];
    const clear = () => {
      for (const el of all()) {
        el.style.transition = "";
        el.style.transform = "";
        el.style.opacity = "";
        el.style.willChange = "";
      }
      root.classList.remove("paging");
      for (const el of root.querySelectorAll(".peek"))
        el.classList.remove("peek");
    };

    /** Nachbarseite sichtbar machen und neben die aktuelle legen */
    const prepare = (target: number) => {
      from = idxRef.current;
      to = target;
      if (!mountedRef.current[to])
        flushSync(() => setMounted((m) => m.map(() => true)));
      const p = panes(),
        f = fixed(),
        h = heads();
      W = box.clientWidth || window.innerWidth;
      const S = window.scrollY;
      const P = box.getBoundingClientRect().top + S;
      p[to].classList.add("peek");
      f[to]?.classList.add("peek");
      h[to]?.classList.add("peek");
      root.classList.add("paging");
      // Ist der Kopf schon weggescrollt, beginnt die neue Liste direkt oben am Bildschirm,
      // sonst steht sie auf gleicher Höhe wie die alte (der Kopf bleibt, wo er ist)
      let T = S <= P ? S : P;
      const docH = document.documentElement.scrollHeight;
      const maxT =
        docH - p[from].offsetHeight + p[to].offsetHeight - window.innerHeight;
      T = Math.max(0, Math.min(T, maxT));
      off = S - T;
      for (const el of [p[from], p[to], f[from], f[to]])
        if (el) el.style.willChange = "transform";
      const th = thumb();
      if (th) th.style.transition = "none";
      render(0);
    };

    /** p: 0 = alte Seite, 1 = neue Seite */
    const render = (p: number) => {
      const P = panes(),
        F = fixed(),
        H = heads(),
        th = thumb();
      const sign = to > from ? -1 : 1;
      const x = sign * p * W;
      const xin = x - sign * W;
      P[from].style.transform = `translate3d(${x}px,0,0)`;
      P[to].style.transform = `translate3d(${xin}px,${off}px,0)`;
      if (F[from]) F[from].style.transform = `translate3d(${x}px,0,0)`;
      if (F[to]) F[to].style.transform = `translate3d(${xin}px,0,0)`;
      if (H[from]) H[from].style.opacity = String(Math.max(0, 1 - p * 1.6));
      if (H[to]) H[to].style.opacity = String(Math.max(0, p * 1.6 - 0.6));
      if (th)
        th.style.transform = `translateX(${(from + (to - from) * p) * 100}%)`;
    };

    /** Gummiband in die Richtung, in der keine Seite mehr kommt */
    const band = (d: number) => {
      const P = panes(),
        F = fixed(),
        th = thumb();
      const cur = idxRef.current;
      P[cur].style.transform = d ? `translate3d(${d}px,0,0)` : "";
      if (F[cur]) F[cur].style.transform = d ? `translate3d(${d}px,0,0)` : "";
      if (th) th.style.transform = `translateX(${(cur - d / W / 3) * 100}%)`;
    };

    const animate = (p: number, ms: number, done: () => void) => {
      const tr = `transform ${ms}ms ${EASE}, opacity ${Math.round(ms * 0.8)}ms ${EASE}`;
      for (const el of all()) el.style.transition = tr;
      render(p);
      setTimeout(done, ms + 30);
    };

    const finish = (commit: boolean) => {
      const S = window.scrollY;
      clear();
      if (commit) {
        flushSync(() => setIdx(to));
        window.scrollTo(0, Math.max(0, S - off));
        onIndexRef.current(to);
      }
      const th = thumb();
      if (th) th.style.transform = `translateX(${idxRef.current * 100}%)`;
      busy.current = false;
    };

    goRef.current = (target: number) => {
      if (busy.current || target === idxRef.current) return;
      busy.current = true;
      prepare(target);
      // Erst den Ausgangszustand zeigen, dann gleiten
      requestAnimationFrame(() =>
        requestAnimationFrame(() => animate(1, 360, () => finish(true))),
      );
    };

    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      const el = e.target as HTMLElement;
      // Auch unter kurzen Listen wischen können: der ganze Inhaltsbereich zählt
      const scope = root.closest(".app") ?? root;
      // Der linke Rand gehört nur auf Seiten mit „Zurück“ der Zurück-Geste; sonst zählt er mit
      const edge = t.clientX < 28 && Boolean(document.querySelector(".navbar"));
      if (
        busy.current ||
        e.touches.length !== 1 ||
        !scope.contains(el) ||
        el.closest(SKIP) ||
        edge ||
        overlayOpen() ||
        inHorizontalScroller(el, root)
      ) {
        state = "idle";
        return;
      }
      state = "maybe";
      x0 = lastX = t.clientX;
      y0 = t.clientY;
      t0 = lastT = performance.now();
      dx = vx = 0;
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const t = e.touches[0];
      if (state === "maybe" && overlayOpen()) {
        state = "idle";
        return;
      }
      if (state === "maybe") {
        const mx = t.clientX - x0,
          my = t.clientY - y0;
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        if (Math.abs(mx) <= Math.abs(my) * 1.3) {
          state = "idle";
          return;
        }
        // Nur die Schwelle abziehen: kommt die erste Bewegung spät (schneller Schnipser, Handy beschäftigt),
        // zählt der schon zurückgelegte Weg mit, sonst ginge der Wisch verloren
        x0 += Math.sign(mx) * 10;
        const target = idxRef.current + (mx < 0 ? 1 : -1);
        busy.current = true;
        // Am Rand des Pagers: gibt es daneben einen Hauptbereich, übernimmt das Wischen zwischen den Bereichen
        if ((target < 0 || target >= box.children.length) && neighborTab(location.pathname, mx < 0 ? 1 : -1)) {
          busy.current = false;
          state = "idle";
          return;
        }
        if (target < 0 || target >= box.children.length) {
          state = "band";
          W = box.clientWidth || window.innerWidth;
          root.classList.add("paging");
          const th = thumb();
          if (th) th.style.transition = "none";
        } else {
          state = "drag";
          prepare(target);
        }
      }
      const now = performance.now();
      const raw = t.clientX - x0;
      // Geschwindigkeit geglättet aus den letzten Bewegungen
      const dt = Math.max(1, now - lastT);
      vx = vx * 0.6 + ((t.clientX - lastX) / dt) * 0.4;
      lastX = t.clientX;
      lastT = now;
      if (state === "band") {
        dx = raw * 0.22;
        band(dx);
        return;
      }
      const sign = to > from ? -1 : 1;
      dx = raw;
      let p = (dx * sign) / W;
      // Über das Ziel hinaus und zurück nur mit Widerstand
      if (p < 0) p = p * 0.25;
      if (p > 1) p = 1 + (p - 1) * 0.25;
      render(p);
    };
    const end = () => {
      if (state === "idle" || state === "maybe") {
        state = "idle";
        return;
      }
      suppressClick = performance.now();
      if (state === "band") {
        state = "idle";
        const P = panes(),
          F = fixed(),
          th = thumb();
        const cur = idxRef.current;
        for (const el of [P[cur], F[cur], th])
          if (el)
            el.style.transition = `transform 420ms cubic-bezier(.3,1.14,.6,1)`;
        band(0);
        setTimeout(() => {
          clear();
          const th2 = thumb();
          if (th2) th2.style.transform = `translateX(${idxRef.current * 100}%)`;
          busy.current = false;
        }, 440);
        return;
      }
      state = "idle";
      const sign = to > from ? -1 : 1;
      const p = (dx * sign) / W;
      const v = vx * sign; // positiv = Richtung neue Seite, px/ms
      const commit = (p > 0.5 && v > -0.2) || (v > 0.35 && p > 0.04);
      const rest = commit ? Math.max(0, 1 - p) : Math.max(0, p);
      // Restweg mit der Wischgeschwindigkeit, aber nie hektisch oder träge
      const speed = Math.max(Math.abs(v), 0.8);
      const ms = Math.round(
        Math.min(380, Math.max(200, (rest * W) / speed + 120)),
      );
      if (commit) haptic(6);
      animate(commit ? 1 : 0, ms, () => finish(commit));
    };
    // Nach einem Wisch kein versehentliches Antippen der Zeile unter dem Finger
    const click = (e: MouseEvent) => {
      if (performance.now() - suppressClick < 350) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    root.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      root.removeEventListener("click", click, true);
      clear();
      busy.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sichtbare Seite zuerst im DOM (Vorlesen, Tastatur); Verschieben kostet bei den kleinen Plätzen nichts
  const order = [idx, ...children.map((_, i) => i).filter((i) => i !== idx)];
  return (
    <div className="pager-wrap" ref={wrap}>
      {heads && (
        <div className="pager-heads">
          {/* Sichtbarer Kopf zuerst im DOM (Vorlesen, Tastatur); Verschieben kostet hier nichts */}
          {order.map((i) => (
            <div
              key={i}
              data-i={i}
              className={`pager-head ${idx === i ? "on" : "off"}`}
              ref={slotRefs.head[i]}
              inert={idx !== i}
            />
          ))}
        </div>
      )}
      <div className={switchClass} ref={sw}>
        <Seg
          value={String(idx)}
          options={labels.map((l, i) => [String(i), l] as [string, string])}
          onChange={(v) => goRef.current(Number(v))}
        />
      </div>
      <div className="pager" ref={pager}>
        {children.map((c, i) => (
          <div
            key={i}
            className={`pager-pane ${idx === i ? "on" : "off"}`}
            inert={idx !== i}
          >
            <PaneCtx.Provider
              value={{
                index: i,
                active: idx === i,
                heads,
                head: headEls[i],
                fixed: fixEls[i],
              }}
            >
              {mounted[i] ? c : null}
            </PaneCtx.Provider>
          </div>
        ))}
      </div>
      {order.map((i) => (
        <div
          key={i}
          data-i={i}
          className={`pager-fixed ${idx === i ? "on" : "off"}`}
          ref={slotRefs.fixed[i]}
        />
      ))}
    </div>
  );
}

/**
 * Wisch-Fläche für Umschalter, deren Seiten sich eine Liste teilen (Freund-Seite, Label, Set-Editor):
 * der Inhalt folgt dem Finger, der Schieber des Umschalters darüber läuft mit, nach dem Loslassen
 * gleitet der neue Inhalt von der Seite herein. Leichter als der Pager (die Nachbarseite existiert
 * hier nicht als eigener Inhalt), gleiche Geste. `index` < 0 schaltet das Wischen ab.
 */
export function SwipeArea({
  index,
  count,
  onIndex,
  className,
  children,
}: {
  index: number;
  count: number;
  onIndex: (i: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = useRef(index);
  const prev = useRef(index);
  const cb = useRef(onIndex);
  cb.current = onIndex;
  idx.current = index;

  // Seitenwechsel (Wisch oder Tippen): neuer Inhalt gleitet aus der passenden Richtung herein
  useLayoutEffect(() => {
    const el = ref.current;
    const from = prev.current;
    prev.current = index;
    if (!el || from === index || from < 0 || index < 0) return;
    const dir = index > from ? 1 : -1;
    el.style.transition = "none";
    el.style.transform = `translate3d(${dir * 22}%,0,0)`;
    el.style.opacity = "0";
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.style.transition = `transform 340ms ${EASE}, opacity 240ms ${EASE}`;
        el.style.transform = "";
        el.style.opacity = "";
        setTimeout(() => (el.style.transition = ""), 360);
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [index]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const thumb = () =>
      el.parentElement?.querySelector<HTMLElement>(
        ":scope > .seg > .seg-thumb",
      ) ?? null;
    let state: "idle" | "maybe" | "drag" = "idle";
    let x0 = 0,
      y0 = 0,
      dx = 0,
      lastX = 0,
      lastT = 0,
      vx = 0,
      W = 1;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      const edge = t.clientX < 28 && Boolean(document.querySelector(".navbar"));
      // Auch unter kurzem Inhalt wischen können: alles im Inhaltsbereich ab der Oberkante der Fläche zählt
      const scope = el.closest(".app") ?? el;
      const inside = el.contains(target) || (scope.contains(target) && t.clientY >= el.getBoundingClientRect().top);
      if (
        idx.current < 0 ||
        e.touches.length !== 1 ||
        !inside ||
        edge ||
        target.closest(SKIP) ||
        overlayOpen() ||
        inHorizontalScroller(target, el)
      ) {
        state = "idle";
        return;
      }
      state = "maybe";
      x0 = lastX = t.clientX;
      y0 = t.clientY;
      lastT = performance.now();
      dx = vx = 0;
    };
    const move = (e: TouchEvent) => {
      if (state === "idle") return;
      const t = e.touches[0];
      if (state === "maybe") {
        const mx = t.clientX - x0,
          my = t.clientY - y0;
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        if (Math.abs(mx) <= Math.abs(my) * 1.3 || overlayOpen()) {
          state = "idle";
          return;
        }
        state = "drag";
        x0 += Math.sign(mx) * 10;
        W = el.clientWidth || window.innerWidth;
        el.style.transition = "none";
        const th = thumb();
        if (th) th.style.transition = "none";
      }
      const now = performance.now();
      vx = vx * 0.6 + ((t.clientX - lastX) / Math.max(1, now - lastT)) * 0.4;
      lastX = t.clientX;
      lastT = now;
      const raw = t.clientX - x0;
      const target = idx.current + (raw < 0 ? 1 : -1);
      // Am Rand (keine Seite mehr) nur mit Widerstand
      dx = target < 0 || target >= count ? raw * 0.22 : raw;
      el.style.transform = `translate3d(${dx}px,0,0)`;
      el.style.opacity = String(1 - Math.min(0.6, Math.abs(dx) / W));
      const th = thumb();
      if (th)
        th.style.transform = `translateX(${Math.max(0, Math.min(count - 1, idx.current - dx / W)) * 100}%)`;
    };
    const end = () => {
      if (state !== "drag") {
        state = "idle";
        return;
      }
      state = "idle";
      const dir = dx < 0 ? 1 : -1;
      const target = idx.current + dir;
      const v = -vx * dir;
      const th = thumb();
      const commit =
        target >= 0 &&
        target < count &&
        (Math.abs(dx) > W * 0.28 || (v > 0.35 && Math.abs(dx) > 24));
      if (th) th.style.transition = "";
      if (commit) {
        haptic(6);
        el.style.transition = `transform 150ms ${EASE}, opacity 150ms ${EASE}`;
        el.style.transform = `translate3d(${-dir * W * 0.5}px,0,0)`;
        el.style.opacity = "0";
        setTimeout(() => cb.current(target), 140);
        // Wechselt die Seite doch nicht, Inhalt wieder zeigen
        setTimeout(() => {
          if (idx.current === target) return;
          el.style.transition = "";
          el.style.transform = "";
          el.style.opacity = "";
        }, 500);
      } else {
        el.style.transition = `transform 380ms ${EASE}, opacity 240ms ${EASE}`;
        el.style.transform = "";
        el.style.opacity = "";
        if (th) th.style.transform = `translateX(${idx.current * 100}%)`;
        setTimeout(() => (el.style.transition = ""), 400);
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [count]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
