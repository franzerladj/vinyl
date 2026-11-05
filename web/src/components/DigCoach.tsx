// Kurze Einführung vor dem ersten Diggen: erst die Gesten, dann jeder Knopf mit Spotlight.
import { useLayoutEffect, useState } from "react";
import { haptic } from "./bits";

const KEY = "crate:coach:dig";

interface Step {
  target?: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { title: "So diggst du", text: "Hoch und runter wischen: nächste Platte. Aufs Cover tippen: Hörprobe an und aus. Nach rechts wischen oder doppeltippen: Mag ich. Nach links wischen: weg damit." },
  { target: '[data-coach="like"] svg', title: "Mag ich", text: "Gefällt dir. Der Feed zeigt dir mehr in diese Richtung. Auf die Wantlist kommt dabei nichts." },
  { target: '[data-coach="skip"] svg', title: "Weg", text: "Nicht dein Ding. Die Platte verschwindet, Ähnliches kommt seltener." },
  { target: '[data-coach="more"] svg', title: "Mehr davon", text: "Gleich mehr vom selben Label und Artist, direkt als nächste Karten." },
  { target: '[data-coach="want"] svg', title: "Want", text: "Direkt auf deine Wantlist bei Discogs. Crate sagt Bescheid, wenn sie günstig zu haben ist." },
  { target: '[data-coach="menu"] svg', title: "Optionen", text: "Hab ich schon, bei Discogs kaufen, teilen oder zur Platten-Seite." },
  { target: ".dig-liked-btn", title: "Deine gemochten Platten", text: "Hier liegt alles, was du gemocht hast. Von da aus geht es mit einem Tipp auf die Wantlist." },
  { target: ".dig-top .dig-icon:last-child", title: "Filter", text: "Nach Jahrzehnt und Preis filtern. Oben in der Leiste wählst du Styles." },
];

const done = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
};

export function DigCoach({ ready }: { ready: boolean }) {
  const [step, setStep] = useState<number | null>(() => (done() ? null : 0));
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = step != null ? STEPS[step] : null;

  useLayoutEffect(() => {
    if (!s?.target) return setRect(null);
    const el = document.querySelector(s.target);
    const measure = () => setRect(el?.getBoundingClientRect() ?? null);
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [s, ready]);

  if (!ready || step == null || !s) return null;
  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* egal */
    }
    setStep(null);
  };
  const next = () => {
    haptic(6);
    if (step + 1 >= STEPS.length) finish();
    else setStep(step + 1);
  };
  // Kreis um den Knopf; Text darüber (Knöpfe unten) oder darunter (Knöpfe oben)
  const r = rect ? Math.max(rect.width, rect.height) / 2 + 8 : 0;
  const cx = rect ? rect.left + rect.width / 2 : 0;
  const cy = rect ? rect.top + rect.height / 2 : 0;
  const below = rect ? cy < innerHeight / 2 : false;
  return (
    <div className="coach" role="dialog" aria-label="Einführung ins Digging" onClick={next}>
      {rect ? (
        <span className="coach-hole" style={{ width: r * 2, height: r * 2, transform: `translate(${cx - r}px, ${cy - r}px)` }} />
      ) : (
        <span className="coach-dim" />
      )}
      <div className={`coach-card${rect ? (below ? " below" : " above") : " center"}`} style={rect ? (below ? { top: cy + r + 14 } : { bottom: innerHeight - cy + r + 14 }) : undefined} onClick={(e) => e.stopPropagation()}>
        <span className="coach-step mono">
          {step + 1}/{STEPS.length}
        </span>
        <b>{s.title}</b>
        <p>{s.text}</p>
        <div className="coach-actions">
          <button className="coach-skip" onClick={finish}>
            Überspringen
          </button>
          <button className="coach-next" onClick={next}>
            {step + 1 >= STEPS.length ? "Los geht's" : "Weiter"}
          </button>
        </div>
      </div>
    </div>
  );
}
