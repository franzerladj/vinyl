// Jahresrückblick als Story: Seite für Seite, Fortschritt oben, tippen vor/zurück, halten = Pause.
// Flache Farbflächen (Schwarz, Lime, Papier), große Archivo-Titel, Bewegung nur über transform/opacity.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptic, keepParens, useBackClose, useRootClass } from "./bits";
import { IconX } from "./icons";
import type { yearReview } from "../../../shared/year";

type Data = ReturnType<typeof yearReview>;
type Slide = { key: string; tone: "ink" | "lime" | "paper" | "grey"; body: React.ReactNode; ms?: number };

/** Zahl zählt beim Erscheinen hoch (ändert nur Text, kein Layout-Sprung dank Tabellenziffern) */
function Count({ to, delay = 250, ms = 1300 }: { to: number; delay?: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = String(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / ms));
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, ms]);
  return <span ref={ref}>0</span>;
}

const d = (i: number) => ({ "--i": i }) as React.CSSProperties;

function slides(data: Data, year: number, name: string): Slide[] {
  const out: Slide[] = [];
  out.push({
    key: "intro",
    tone: "ink",
    ms: 4200,
    body: (
      <>
        <div className="ys-disc" aria-hidden>
          <span />
        </div>
        <span className="ys-eyebrow" style={d(1)}>
          {name ? `${name}, dein Jahr auf Platte` : "Dein Jahr auf Platte"}
        </span>
        <b className="ys-giant" style={d(2)}>
          {year}
        </b>
      </>
    ),
  });
  if (data.added > 0) {
    const covers = data.addedCovers.map((r) => r.cover || r.thumb).filter(Boolean) as string[];
    out.push({
      key: "added",
      tone: "lime",
      body: (
        <>
          <span className="ys-eyebrow" style={d(0)}>
            Neu in der Kiste
          </span>
          <b className="ys-giant" style={d(1)}>
            <Count to={data.added} />
          </b>
          <span className="ys-line" style={d(2)}>
            {data.added === 1 ? "Platte ist dazugekommen." : "Platten sind dazugekommen."}
          </span>
          {covers.length > 0 && (
            <div className="ys-stack" aria-hidden>
              {covers.slice(0, 5).map((c, i) => (
                <img key={i} src={c} alt="" style={d(i)} />
              ))}
            </div>
          )}
        </>
      ),
    });
  }
  if (data.topStyles.length) {
    const max = data.topStyles[0].n;
    out.push({
      key: "style",
      tone: "ink",
      body: (
        <>
          <span className="ys-eyebrow" style={d(0)}>
            Dein Style des Jahres
          </span>
          <b className="ys-big" style={d(1)}>
            {data.topStyles[0].name}
          </b>
          <div className="ys-bars">
            {data.topStyles.map((s, i) => (
              <div key={s.name} className="ys-bar" style={d(i + 2)}>
                <span>{s.name}</span>
                <em>{s.n}</em>
                <i style={{ transform: `scaleX(${Math.max(0.12, s.n / max)})` }} />
              </div>
            ))}
          </div>
        </>
      ),
    });
  }
  if (data.topLabels.length) {
    out.push({
      key: "label",
      tone: "paper",
      body: (
        <>
          <span className="ys-eyebrow" style={d(0)}>
            Label des Jahres
          </span>
          <b className="ys-big" style={d(1)}>
            {data.topLabels[0].name}
          </b>
          <span className="ys-line" style={d(2)}>
            {data.topLabels[0].n === 1 ? "Eine neue Platte" : `${data.topLabels[0].n} neue Platten`} von diesem Label.
          </span>
          {data.topLabels.length > 1 && (
            <span className="ys-small mono" style={d(3)}>
              Dahinter: {data.topLabels.slice(1).map((l) => l.name).join(" · ")}
            </span>
          )}
        </>
      ),
    });
  }
  if (data.sets > 0) {
    out.push({
      key: "sets",
      tone: "grey",
      body: (
        <>
          <span className="ys-eyebrow" style={d(0)}>
            Hinter den Decks
          </span>
          <div className="ys-duo">
            <div style={d(1)}>
              <b className="ys-giant">
                <Count to={data.sets} />
              </b>
              <span>{data.sets === 1 ? "Set" : "Sets"}</span>
            </div>
            {data.hours > 0 && (
              <div style={d(2)}>
                <b className="ys-giant">
                  <Count to={data.hours} delay={450} />
                </b>
                <span>Stunden</span>
              </div>
            )}
          </div>
          {data.venues > 0 && (
            <span className="ys-line" style={d(3)}>
              an {data.venues === 1 ? "einem Ort" : `${data.venues} Orten`}.
            </span>
          )}
        </>
      ),
    });
  }
  if (data.mostPlayed.length) {
    const first = data.mostPlayed[0].release!;
    out.push({
      key: "played",
      tone: "ink",
      ms: 7000,
      body: (
        <>
          <span className="ys-eyebrow" style={d(0)}>
            Am häufigsten aufgelegt
          </span>
          <div className="ys-sleeve" style={d(1)} aria-hidden>
            <span className="ys-record" />
            {(first.cover || first.thumb) && <img src={first.cover || first.thumb} alt="" />}
          </div>
          <ol className="ys-list">
            {data.mostPlayed.map(({ release: r, n }, i) => (
              <li key={r!.id} style={d(i + 2)}>
                <span className="mono">{i + 1}</span>
                <b>{keepParens(r!.title)}</b>
                <em>{r!.artist}</em>
                <span className="mono">{n}×</span>
              </li>
            ))}
          </ol>
        </>
      ),
    });
  }
  if (data.oldest) {
    out.push({
      key: "oldest",
      tone: "lime",
      body: (
        <>
          <span className="ys-eyebrow" style={d(0)}>
            Ältester Neuzugang
          </span>
          <b className="ys-giant" style={d(1)}>
            {data.oldest.year}
          </b>
          <span className="ys-line" style={d(2)}>
            <b>{keepParens(data.oldest.title)}</b> von {data.oldest.artist}
          </span>
          <span className="ys-small mono" style={d(3)}>
            {year - data.oldest.year} Jahre alt und trotzdem neu bei dir.
          </span>
        </>
      ),
    });
  }
  out.push({
    key: "outro",
    tone: "ink",
    ms: 60000,
    body: null,
  });
  return out;
}

export function YearStory({ data, year, name, onClose, onShare }: { data: Data; year: number; name: string; onClose: () => void; onShare: () => void }) {
  const list = slides(data, year, name);
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const press = useRef<{ t: number; x: number; y: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  useRootClass("in-story", true);
  useBackClose(true, onClose);
  const go = (n: number) => {
    if (n < 0) return setI(0);
    if (n >= list.length) return onClose();
    haptic(4);
    setI(n);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const s = list[i];
  const last = s.key === "outro";
  return createPortal(
    <div
      className={`ys ys-${s.tone}${held ? " held" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Rückblick ${year}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const p = { t: performance.now(), x: e.clientX, y: e.clientY } as NonNullable<typeof press.current>;
        p.timer = setTimeout(() => setHeld(true), 180);
        press.current = p;
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        clearTimeout(p.timer);
        const wasHeld = held || performance.now() - p.t > 180;
        setHeld(false);
        if (e.clientY - p.y > 110) return onClose(); // nach unten wischen schließt
        if (wasHeld && performance.now() - p.t > 260) return;
        if (Math.abs(e.clientX - p.x) > 40) return go(i + (e.clientX < p.x ? 1 : -1));
        go(i + (e.clientX < window.innerWidth * 0.3 ? -1 : 1));
      }}
      onPointerCancel={() => {
        clearTimeout(press.current?.timer);
        press.current = null;
        setHeld(false);
      }}
    >
      <div className="ys-progress" aria-hidden>
        {list.map((x, n) => (
          <span key={x.key} className={n < i ? "done" : ""}>
            {n === i && <i key={`${x.key}-${i}`} style={{ animationDuration: `${x.ms ?? 5600}ms` }} onAnimationEnd={() => !last && go(i + 1)} />}
          </span>
        ))}
      </div>
      <button className="ys-close" onClick={onClose} aria-label="Schließen">
        <IconX />
      </button>
      <div className="ys-slide" key={s.key}>
        {last ? (
          <>
            <span className="ys-eyebrow" style={d(0)}>
              Das war {year}
            </span>
            <b className="ys-big" style={d(1)}>
              Dig deeper.
            </b>
            <div className="ys-actions" style={d(2)}>
              <button className="btn lg ys-btn" onClick={onShare}>
                In die Story teilen
              </button>
              <button className="btn lg ys-btn ghost" onClick={() => setI(0)}>
                Nochmal ansehen
              </button>
            </div>
          </>
        ) : (
          s.body
        )}
      </div>
    </div>,
    document.body,
  );
}
