// Einmalige Begrüßung nach der Anmeldung und kleine Hinweise beim ersten Benutzen.
import { useEffect, useState } from "react";
import { haptic, Sheet } from "./bits";
import { LogoMark } from "./Logo";

const STEPS: { pos: string; title: string; text: string }[] = [
  {
    pos: "A1",
    title: "Deine Kiste wird gefüllt",
    text: "Crate holt Sammlung und Wantlist von Discogs und ergänzt Tracklists, Preise, BPM und Key. Beim ersten Mal dauert das ein paar Minuten und läuft im Hintergrund weiter.",
  },
  {
    pos: "A2",
    title: "Tempo und Tonart",
    text: "Tippe auf einen Track zum Reinhören und Beschriften. Fehlt ein Wert, hilft Mithören: Platte auflegen, Handy zur Box halten. Oder einfach im Takt tippen.",
  },
  {
    pos: "B1",
    title: "Sets aus der Kiste",
    text: "Pack Platten in die Kiste, Crate schlägt die Reihenfolge nach Energie, BPM und Tonart vor. Per Link sehen Freunde, welche Platten sie davon selbst haben.",
  },
  {
    pos: "B2",
    title: "Für Sammler",
    text: "Zustand nach Goldmine, Matrix und Presswerk, der Wert deiner Sammlung, fehlende Platten deiner Labels und Händler, die gleich mehrere deiner Wants haben.",
  },
];

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* egal */
  }
};

export function Welcome({ username }: { username: string }) {
  const key = `crate:welcome:${username.toLowerCase()}`;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    // Kurz warten, damit die Startseite schon steht
    const t = setTimeout(() => setOpen(!read(key)), 700);
    return () => clearTimeout(t);
  }, [key]);
  const close = () => {
    write(key, String(Date.now()));
    setOpen(false);
  };
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <Sheet open={open} onClose={close}>
      <div className="welcome">
        {step === 0 && (
          <div className="welcome-mark">
            <LogoMark size={88} animate />
          </div>
        )}
        <span className="welcome-pos mono">
          {s.pos} · {step + 1}/{STEPS.length}
        </span>
        <h2 className="welcome-title">{s.title}</h2>
        <p className="welcome-text">{s.text}</p>
        <div className="welcome-dots" aria-hidden>
          {STEPS.map((x, i) => (
            <span key={x.pos} className={i === step ? "on" : ""} />
          ))}
        </div>
        <button
          className="btn primary block lg"
          onClick={() => {
            haptic(8);
            if (last) close();
            else setStep(step + 1);
          }}
        >
          {last ? "Los geht's" : "Weiter"}
        </button>
        {!last && (
          <button className="btn ghost block" onClick={close}>
            Überspringen
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Kleiner Hinweis, der nur beim ersten Mal erscheint und sich wegtippen lässt */
export function Hint({ id, children }: { id: string; children: React.ReactNode }) {
  const key = `crate:hint:${id}`;
  const [show, setShow] = useState(() => !read(key));
  if (!show) return null;
  return (
    <div className="hint" role="note">
      <span className="hint-text">{children}</span>
      <button
        className="hint-x"
        aria-label="Hinweis schließen"
        onClick={() => {
          write(key, "1");
          setShow(false);
        }}
      >
        Verstanden
      </button>
    </div>
  );
}
