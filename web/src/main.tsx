import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App, { ErrorPage, routes } from "./App";
// Schriften lokal ausliefern (keine Verbindung zu Google Fonts, DSGVO)
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles.css";
import { applyTheme } from "./lib/theme";
import { registerSW } from "virtual:pwa-register";
import { getState, setState } from "./lib/store";

applyTheme();

// Neue Version: nicht mitten in einem Sync neu laden, sondern Bescheid geben.
// Läuft gerade nichts und die App ist im Hintergrund, wird still aktualisiert.
const updateSW = registerSW({
  onNeedRefresh() {
    const apply = () => updateSW(true);
    setState({ updateReady: apply });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && Object.keys(getState().jobs).length === 0) apply();
    });
  },
});

// Richtung des Seitenwechsels für die Animation: Zurück (Geste, Taste, Browser) gleitet nach rechts
window.addEventListener(
  "popstate",
  () => {
    document.documentElement.classList.add("vt-back");
    document.documentElement.classList.remove("vt-tab");
  },
  true,
);
document.addEventListener(
  "click",
  (e) => {
    const el = e.target as HTMLElement;
    const a = el.closest("a, button");
    if (!a) return;
    const root = document.documentElement.classList;
    root.toggle("vt-tab", Boolean(a.closest(".nav")));
    root.toggle("vt-back", Boolean(a.closest(".back-btn, [data-back]")));
  },
  true,
);

const router = createBrowserRouter([{ path: "/", element: <App />, errorElement: <ErrorPage />, children: [{ errorElement: <ErrorPage />, children: routes }] }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Startbildschirm aus index.html: Schriftzug erst zeigen, wenn die Markenschrift da ist,
// beim ersten Öffnen kurz stehen lassen, danach (z. B. nach Neuladen) gleich ausblenden.
const splash = document.getElementById("splash");
if (splash) {
  let seen = false;
  try {
    seen = sessionStorage.getItem("crate:splash") === "1";
    sessionStorage.setItem("crate:splash", "1");
  } catch {
    /* egal */
  }
  Promise.all([document.fonts.load('900 40px "Archivo Variable"'), document.fonts.load('600 12px "JetBrains Mono Variable"')])
    .then(() => splash.classList.add("fonts"))
    .catch(() => undefined);
  const minMs = seen ? 300 : 1400;
  requestAnimationFrame(() =>
    setTimeout(() => {
      splash.classList.add("out");
      setTimeout(() => splash.remove(), 450);
    }, Math.max(0, minMs - performance.now())),
  );
}

// Merker für das automatische Neuladen nach einem Update zurücksetzen, sobald die App läuft
setTimeout(() => sessionStorage.removeItem("crate:reloaded"), 10_000);

// Am Computer: Mausrad über Karussells (Zuletzt hinzugefügt, Hörproben, Feed-Chips) scrollt seitwärts
if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".carousel, .preview-scroll, .dig-chips");
      if (!el || el.scrollWidth <= el.clientWidth) return;
      const atEnd = e.deltaY > 0 ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 : el.scrollLeft <= 0;
      if (atEnd) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
}
