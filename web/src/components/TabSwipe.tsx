// Seitlich zwischen den Hauptbereichen wischen: der Inhalt folgt dem Finger, die Tab-Leiste bleibt stehen,
// nach dem Loslassen gleitet der Nachbarbereich herein. Regeln und Reihenfolge in lib/tabSwipe.ts.
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { haptic, inHorizontalScroller, overlayOpen } from "./bits";
import { neighborTab, pagerCanMove } from "../lib/tabSwipe";

const EASE = "cubic-bezier(.32,.72,0,1)";
const SKIP = ".carousel, .toolbar-row, .folder-tabs, .chips-scroll, .seg, .sheet, .sheet-backdrop, [role=dialog], .alpha-index, input, textarea, select, nav, .nav, .side, .topbar, .mini-player, .jobs, .fab, [data-no-pager]";

export function TabSwipe() {
  const loc = useLocation();
  const nav = useNavigate();
  const path = loc.pathname;
  const enter = useRef<0 | 1 | -1>(0);

  // Nach dem Wechsel: neuer Bereich gleitet aus der Wischrichtung herein
  useLayoutEffect(() => {
    const dir = enter.current;
    enter.current = 0;
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    if (!dir) {
      main.style.transform = "";
      main.style.opacity = "";
      return;
    }
    main.style.transition = "none";
    main.style.transform = `translate3d(${dir * 26}%,0,0)`;
    main.style.opacity = "0";
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        main.style.transition = `transform 340ms ${EASE}, opacity 240ms ${EASE}`;
        main.style.transform = "";
        main.style.opacity = "";
        setTimeout(() => {
          main.style.transition = "";
          document.documentElement.classList.remove("pulling");
        }, 360);
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!neighborTab(path, 1) && !neighborTab(path, -1)) return;
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    let state: "idle" | "maybe" | "drag" = "idle";
    let x0 = 0, y0 = 0, dx = 0, lastX = 0, lastT = 0, vx = 0, W = 1;
    let step: ReturnType<typeof neighborTab> = null;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      const el = e.target as HTMLElement;
      if (e.touches.length !== 1 || !el.closest(".app") || el.closest(SKIP) || overlayOpen() || inHorizontalScroller(el, main)) {
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
        const mx = t.clientX - x0, my = t.clientY - y0;
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        const dir = mx < 0 ? 1 : -1;
        // Senkrecht = scrollen. Kann der Pager der Seite noch blättern, ist er dran.
        if (Math.abs(mx) <= Math.abs(my) * 1.3 || overlayOpen() || pagerCanMove(dir)) {
          state = "idle";
          return;
        }
        step = neighborTab(path, dir);
        if (!step) {
          state = "idle";
          return;
        }
        state = "drag";
        x0 += Math.sign(mx) * 10;
        W = window.innerWidth;
        main.style.transition = "none";
        // Feste Knöpfe im verschobenen Inhalt säßen falsch
        document.documentElement.classList.add("pulling");
      }
      const now = performance.now();
      vx = vx * 0.6 + ((t.clientX - lastX) / Math.max(1, now - lastT)) * 0.4;
      lastX = t.clientX;
      lastT = now;
      const raw = t.clientX - x0;
      const dir = raw < 0 ? 1 : -1;
      // Wo es nicht weitergeht (oder der Pager dran wäre), nur mit Widerstand
      dx = neighborTab(path, dir) && !pagerCanMove(dir) ? raw : raw * 0.22;
      main.style.transform = `translate3d(${dx}px,0,0)`;
      main.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / W));
    };
    const end = () => {
      if (state !== "drag") {
        state = "idle";
        return;
      }
      state = "idle";
      const dir = dx < 0 ? 1 : -1;
      const target = pagerCanMove(dir) ? null : neighborTab(path, dir);
      const v = -vx * dir;
      if (target && (Math.abs(dx) > W * 0.28 || (v > 0.4 && Math.abs(dx) > 28))) {
        haptic(6);
        main.style.transition = `transform 150ms ${EASE}, opacity 150ms ${EASE}`;
        main.style.transform = `translate3d(${-dir * W * 0.5}px,0,0)`;
        main.style.opacity = "0";
        setTimeout(() => {
          enter.current = dir;
          nav(target.path, { state: target.state });
        }, 140);
      } else {
        main.style.transition = `transform 380ms ${EASE}, opacity 240ms ${EASE}`;
        main.style.transform = "";
        main.style.opacity = "";
        setTimeout(() => {
          main.style.transition = "";
          document.documentElement.classList.remove("pulling");
        }, 400);
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
  }, [path, nav]);
  return null;
}
