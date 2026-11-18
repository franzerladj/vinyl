// Abgleich in Klartext: was gerade läuft, wie weit es ist, wie lange es noch dauert und wozu.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { discogsPauseMs } from "../lib/api";
import { jobText, overallEta, pauseText } from "../../../shared/syncText";
import { Sheet } from "./bits";
import { IconCheck } from "./icons";

/** Jede Sekunde neu zeichnen, solange etwas läuft (Restzeit und Pause zählen herunter) */
export function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

export function SyncStatus({ why = true }: { why?: boolean }) {
  const jobs = useStore((s) => s.jobs);
  const list = Object.values(jobs);
  useTick(list.length > 0);
  const now = Date.now();
  const pauseMs = discogsPauseMs();
  const pause = pauseText(pauseMs);
  return (
    <div className="sync-list" aria-live="polite">
      {list.map((j) => {
        const t = jobText(j, list, now, pauseMs);
        return (
          <div key={j.id} className="sync-job">
            <b>{t.title}</b>
            <div className="sync-meta">
              <span>{t.count || "läuft"}</span>
              {t.eta && <span>{t.eta}</span>}
            </div>
            <div className="progress">
              <div style={{ transform: `scaleX(${j.total > 1 ? Math.max(0.03, t.part) : 0.06})` }} />
            </div>
            {why && t.why && <p className="tiny">{t.why}</p>}
          </div>
        );
      })}
      {pause && <p className="sync-pause">{pause}</p>}
    </div>
  );
}

export function SyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const jobs = useStore((s) => s.jobs);
  const list = Object.values(jobs);
  useTick(open && list.length > 0);
  const eta = overallEta(list, Date.now(), discogsPauseMs());
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack sync-sheet">
        <div className="sheet-title">
          <h3>Abgleich</h3>
          <button className="text-btn" onClick={onClose}>
            Fertig
          </button>
        </div>
        {list.length ? (
          <>
            <p className="sync-lead">
              Crate holt gerade Neues von Discogs und ergänzt, was fehlt.{eta ? ` Alles zusammen ${eta}${eta.endsWith(".") ? "" : "."}` : ""}
            </p>
            <SyncStatus />
            <p className="tiny">Läuft im Hintergrund weiter, du kannst die App normal benutzen. Schließt du sie, geht es beim nächsten Öffnen dort weiter.</p>
          </>
        ) : (
          <p className="sync-done">
            <IconCheck /> Alles auf dem neuesten Stand.
          </p>
        )}
        <Link to="/settings/sync" className="btn block" onClick={onClose}>
          Einstellungen zum Abgleich
        </Link>
      </div>
    </Sheet>
  );
}
