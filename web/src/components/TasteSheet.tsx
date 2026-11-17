import { useEffect, useState } from "react";
import { Sheet, haptic } from "./bits";
import { IconX } from "./icons";
import { forgetTaste, loadTaste, resetTaste } from "../lib/dig";
import { ask } from "../lib/store";
import { decadeLabel } from "../../../shared/dig";
import { topTaste, type Taste } from "../../../shared/taste";

const GROUPS: [string, string, number][] = [
  ["s", "Styles", 8],
  ["l", "Labels", 6],
  ["a", "Artists", 6],
  ["d", "Jahrzehnte", 4],
];

/** Was der Feed über dich gelernt hat, mit „weniger davon“ je Eintrag */
export function TasteSheet({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const [t, setT] = useState<Taste | null>(null);
  useEffect(() => {
    if (open) void loadTaste().then(setT);
  }, [open]);
  const drop = async (key: string) => {
    haptic(8);
    setT(await forgetTaste(key));
    onChanged?.();
  };
  const reset = async () => {
    if (!(await ask({ title: "Geschmack zurücksetzen?", body: "Der Feed beginnt wieder bei deiner Sammlung. Likes und Wantlist bleiben.", ok: "Zurücksetzen", danger: true }))) return;
    setT(await resetTaste());
    onChanged?.();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="taste stack">
        <div>
          <b className="taste-title">Dein Geschmack</b>
          <p className="sub">Der Feed lernt aus allem, was du tust: wie lange du bei einer Platte bleibst, ob du reinhörst, Likes, Wants und was du wegwischst.{t && t.total > 0 ? ` Bisher aus ${t.total} Platten.` : ""}</p>
        </div>
        {t &&
          GROUPS.map(([kind, label, n]) => {
            const rows = topTaste(t, kind, n);
            if (!rows.length) return null;
            const max = Math.max(...rows.map((r) => r.value));
            return (
              <section key={kind} className="taste-group">
                <span className="taste-h">{label}</span>
                {rows.map((r) => (
                  <div key={r.key} className="taste-row">
                    <span className="taste-name">{kind === "d" ? decadeLabel(Number(r.key)) : r.key}</span>
                    <span className="taste-bar" aria-hidden>
                      <i style={{ transform: `scaleX(${Math.max(0.06, r.value / max)})` }} />
                    </span>
                    <button className="taste-x" onClick={() => void drop(`${kind}:${r.key}`)} aria-label={`Weniger ${r.key}`}>
                      <IconX />
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
        <button className="btn block ghost" onClick={() => void reset()}>
          Geschmack zurücksetzen
        </button>
      </div>
    </Sheet>
  );
}
