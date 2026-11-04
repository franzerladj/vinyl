import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
