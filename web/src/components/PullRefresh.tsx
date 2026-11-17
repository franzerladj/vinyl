// Ziehen zum Aktualisieren, wie in nativen Apps: oben am Seitenanfang nach unten ziehen.
// Der Inhalt folgt dem Finger gedämpft (nur transform), eine kleine Platte dreht sich mit,
// beim Loslassen über der Schwelle wird aktualisiert.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { haptic, overlayOpen } from "./bits";
import { autoPipeline } from "../lib/sync";
import { refreshSocial } from "../lib/social";
import { toast } from "../lib/store";

const ROOTS = ["/", "/collection", "/wants", "/friends", "/sets"];
const THRESHOLD = 72;

async function refreshFor(path: string) {
  if (path === "/friends") {
    await refreshSocial().catch(() => undefined);
    return;
  }
  if (path === "/sets") return;
  if (!navigator.onLine) throw new Error("Kein Netz");
  await autoPipeline({ force: true });
}

export function PullRefresh() {
  const loc = useLocation();
  const ind = useRef<HTMLDivElement>(null);
  const path = loc.pathname;
  useEffect(() => {
    if (!ROOTS.includes(path) || matchMedia("(min-width: 1024px)").matches) return;
    const main = document.querySelector<HTMLElement>(".main");
    const el = ind.current;
    if (!main || !el) return;
    let y0 = 0, x0 = 0, d = 0, state: "idle" | "maybe" | "pull" | "busy" = "idle";
    let armed = false;
    const paint = (dist: number, ms = 0) => {
      const tr = ms ? `transform ${ms}ms cubic-bezier(.32,.72,0,1), opacity ${ms}ms` : "none";
      main.style.transition = tr;
      el.style.transition = tr;
      main.style.transform = dist ? `translate3d(0,${dist}px,0)` : "";
      // Feste Knöpfe im verschobenen Inhalt säßen falsch: solange gezogen wird, ausblenden
      document.documentElement.classList.toggle("pulling", dist > 0);
      el.style.opacity = String(Math.min(1, dist / 40));
      el.style.transform = `translate3d(-50%,${dist - 44}px,0) rotate(${dist * 4}deg) scale(${0.6 + Math.min(1, dist / THRESHOLD) * 0.4})`;
    };
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      if (state === "busy" || window.scrollY > 0 || e.touches.length !== 1 || target.closest(".nav, .mini-player, .jobs, input, textarea") || overlayOpen()) {
        state = "idle";
        return;
      }
      state = "maybe";
      y0 = t.clientY;
      x0 = t.clientX;
      d = 0;
      armed = false;
    };
    const move = (e: TouchEvent) => {
      if (state !== "maybe" && state !== "pull") return;
      const t = e.touches[0];
      const dy = t.clientY - y0, dx = t.clientX - x0;
      if (state === "maybe") {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0 || overlayOpen()) {
          state = "idle";
          return;
        }
        state = "pull";
        y0 = t.clientY;
      }
      // Gedämpft: je weiter, desto schwerer
      d = Math.max(0, 110 * (1 - Math.exp(-(t.clientY - y0) / 160)));
      if (d >= THRESHOLD * 0.9 !== armed) {
        armed = !armed;
        if (armed) haptic(10);
      }
      paint(d);
    };
    const end = () => {
      if (state !== "pull") {
        if (state === "maybe") state = "idle";
        return;
      }
      if (!armed) {
        state = "idle";
        paint(0, 320);
        return;
      }
      state = "busy";
      paint(56, 260);
      el.classList.add("spin");
      refreshFor(path)
        .catch((err) => toast((err as Error).message || "Aktualisieren ging nicht"))
        .finally(() => {
          el.classList.remove("spin");
          paint(0, 360);
          setTimeout(() => {
            state = "idle";
            main.style.transition = "";
          }, 380);
        });
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
      main.style.transform = "";
      main.style.transition = "";
    };
  }, [path]);
  return <div className="ptr no-print" ref={ind} aria-hidden />;
}
