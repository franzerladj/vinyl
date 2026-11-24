// „Die Kiste in Bildern“ auf /dj: wie die Sammlung gewachsen ist, wann gekauft wurde, aus welchen Jahren die
// Platten stammen und welche Styles, Labels und Länder vorn liegen. Anregung: die Diagramme von Bklit UI
// (Fadenkreuz mit Wert am Finger, federnder Aufbau). Gezeichnet mit eigenem SVG und CSS im Crate-Look, weil Bklit
// Tailwind, shadcn und Motion voraussetzt. Zahlen: shared/kiste.ts.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { haptic, Seg } from "./bits";
import { db } from "../lib/db";
import { kisteStats, monthLabel, monthName, plattenText, type KisteStats } from "../../../shared/kiste";

const num = (n: number) => n.toLocaleString("de-DE");

/** Finger oder Maus über dem Diagramm: liefert die Stelle (0 bis n−1), Pfeiltasten gehen auch */
function useScrub(n: number) {
  const [at, setAt] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const pick = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    if (i !== last.current) {
      last.current = i;
      setAt(i);
    }
  };
  return {
    at,
    props: {
      tabIndex: 0,
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        haptic(4);
        pick(e);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => (e.pointerType === "mouse" || e.buttons > 0 || e.pressure > 0) && pick(e),
      onPointerLeave: (e: React.PointerEvent<HTMLElement>) => e.pointerType === "mouse" && setAt(null),
      onBlur: () => setAt(null),
      onKeyDown: (e: React.KeyboardEvent) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        setAt((v) => (e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.max(0, Math.min(n - 1, (v ?? (step > 0 ? -1 : n)) + step))));
      },
    },
  };
}

/** Wert am Fadenkreuz: Zahl zuerst, Beschriftung danach. Bleibt am Rand im Bild. */
function Tip({ x, value, label }: { x: number; value: string; label: string }) {
  const side = x < 0.22 ? "left" : x > 0.78 ? "right" : "mid";
  return (
    <div className={`kc-tip ${side}`} style={{ left: `${x * 100}%` }} role="status">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Growth({ s }: { s: KisteStats }) {
  const g = s.growth;
  const scrub = useScrub(g.length);
  const max = Math.max(1, g[g.length - 1].total);
  const W = 320;
  const H = 120;
  const X = (i: number) => (g.length > 1 ? (i / (g.length - 1)) * W : W);
  const Y = (v: number) => H - 4 - (v / max) * (H - 12);
  const line = g.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.total).toFixed(1)}`).join(" ");
  const at = scrub.at;
  const cur = at == null ? g[g.length - 1] : g[at];
  const perMonth = g.length ? Math.round((s.growth[g.length - 1].total / g.length) * 10) / 10 : 0;
  return (
    <div className="card djo-card kc">
      <div className="djo-head">
        <b>Gewachsen</b>
        <span className="sub">{at == null ? `seit ${monthLabel(g[0].month)}` : monthLabel(cur.month)}</span>
      </div>
      <div className="djo-big">
        <b>{num(cur.total)}</b>
        <span>{at == null ? "Platten heute" : cur.added ? `Platten, davon ${num(cur.added)} neu` : "Platten"}</span>
      </div>
      <div className="kc-plot kc-area" {...scrub.props} role="img" aria-label={`Deine Sammlung ist seit ${monthLabel(g[0].month)} auf ${num(g[g.length - 1].total)} Platten gewachsen. Mit den Pfeiltasten Monat für Monat durchgehen.`}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <path className="kc-fill" d={`${line} L${W} ${H} L0 ${H} Z`} />
          <path className="kc-line" d={line} />
        </svg>
        {at != null && (
          <>
            <i className="kc-cross" style={{ left: `${(X(at) / W) * 100}%` }} />
            <i className="kc-dot" style={{ left: `${(X(at) / W) * 100}%`, top: `${(Y(cur.total) / H) * 100}%` }} />
            <Tip x={X(at) / W} value={num(cur.total)} label={monthLabel(cur.month)} />
          </>
        )}
      </div>
      <div className="kc-axis">
        <span>{g[0].month.slice(0, 4)}</span>
        <span>heute</span>
      </div>
      <p className="djo-note">Im Schnitt {perMonth.toLocaleString("de-DE")} Platten im Monat. Fahr mit dem Finger über die Kurve.</p>
    </div>
  );
}

function Calendar({ s, today }: { s: KisteStats; today: string }) {
  const [sel, setSel] = useState<{ y: number; m: number } | null>(null);
  const { years, max, best } = s.calendar;
  const nowY = Number(today.slice(0, 4));
  const nowM = Number(today.slice(5, 7));
  const level = (n: number) => (n === 0 ? 0 : max <= 1 ? 4 : 1 + Math.min(3, Math.floor(((n - 1) / (max - 1)) * 3.999)));
  const shown = sel ?? (best ? { y: best.year, m: best.month } : null);
  const shownN = shown ? (years.find((y) => y.year === shown.y)?.months[shown.m - 1] ?? 0) : 0;
  return (
    <div className="card djo-card kc">
      <div className="djo-head">
        <b>Wann du gekauft hast</b>
        <span className="sub">je Monat</span>
      </div>
      <div className="kc-cal" role="grid" aria-label="Neue Platten je Monat und Jahr">
        <div className="kc-cal-row head" aria-hidden>
          <span />
          {Array.from({ length: 12 }, (_, k) => (
            <span key={k}>{monthName(k + 1)[0]}</span>
          ))}
          <span />
        </div>
        {years.map((y, ri) => (
          <div className="kc-cal-row" role="row" key={y.year}>
            <span className="kc-cal-year">{y.year}</span>
            {y.months.map((n, k) => {
              const future = y.year === nowY && k + 1 > nowM;
              const on = shown?.y === y.year && shown.m === k + 1;
              return (
                <button
                  key={k}
                  role="gridcell"
                  className={`kc-cell l${level(n)}${future ? " future" : ""}${on ? " on" : ""}`}
                  style={{ animationDelay: `${(ri * 12 + k) * 6}ms` }}
                  disabled={future}
                  aria-label={`${monthName(k + 1)} ${y.year}: ${plattenText(n)}`}
                  aria-pressed={on}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setSel({ y: y.year, m: k + 1 })}
                  onFocus={() => setSel({ y: y.year, m: k + 1 })}
                  onClick={() => {
                    haptic(4);
                    setSel({ y: y.year, m: k + 1 });
                  }}
                />
              );
            })}
            <span className="kc-cal-sum">{num(y.sum)}</span>
          </div>
        ))}
      </div>
      {shown && (
        <p className="djo-note kc-read" aria-live="polite">
          <b>{plattenText(shownN)}</b> im {monthName(shown.m)} {shown.y}
          {!sel && best ? ": dein stärkster Monat" : ""}
        </p>
      )}
      <div className="kc-scale" aria-hidden>
        <span>wenig</span>
        {[1, 2, 3, 4].map((l) => (
          <i key={l} className={`kc-cell l${l}`} />
        ))}
        <span>viel</span>
      </div>
    </div>
  );
}

function Years({ s }: { s: KisteStats }) {
  const ys = s.years;
  const scrub = useScrub(ys.length);
  const max = Math.max(1, ...ys.map((y) => y.n));
  const at = scrub.at;
  const peak = s.peakYear!;
  const cur = at == null ? peak : ys[at];
  // Beschriftung der Achse: volle Jahrzehnte, bei kurzer Spanne Anfang und Ende
  const ticks = ys.map((y, i) => ({ y: y.year, i })).filter((t) => t.y % 10 === 0);
  const sparse = ticks.length > 6 ? ticks.filter((t) => t.y % 20 === 0) : ticks;
  return (
    <div className="card djo-card kc">
      <div className="djo-head">
        <b>Aus welchen Jahren</b>
        <span className="sub">Erscheinungsjahr</span>
      </div>
      <div className="djo-big">
        <b>{cur.year}</b>
        <span>{at == null ? `liegt vorn: ${plattenText(cur.n)}` : plattenText(cur.n)}</span>
      </div>
      <div className="kc-plot kc-bars" {...scrub.props} role="img" aria-label={`Erscheinungsjahre deiner Platten von ${ys[0].year} bis ${ys[ys.length - 1].year}. Die meisten sind von ${peak.year}. Mit den Pfeiltasten Jahr für Jahr durchgehen.`}>
        {ys.map((y, i) => (
          <i key={y.year} className={`${y.year === peak.year ? "top" : ""}${at === i ? " on" : ""}`} style={{ height: `${y.n ? Math.max(3, (y.n / max) * 100) : 0}%`, animationDelay: `${Math.min(i * 8, 420)}ms` }} />
        ))}
        {at != null && <Tip x={ys.length > 1 ? at / (ys.length - 1) : 0.5} value={plattenText(cur.n)} label={String(cur.year)} />}
      </div>
      <div className="kc-ticks" aria-hidden>
        {(sparse.length ? sparse : [{ y: ys[0].year, i: 0 }]).map((t) => (
          <span key={t.y} style={{ left: `${ys.length > 1 ? ((t.i + 0.5) / ys.length) * 100 : 50}%` }}>
            {t.y}
          </span>
        ))}
      </div>
      {s.noYear > 0 && <p className="djo-note">{plattenText(s.noYear)} ohne Jahr bei Discogs.</p>}
    </div>
  );
}

type Rank = "styles" | "labels" | "countries";
function Ranks({ s }: { s: KisteStats }) {
  const tabs = ([["styles", "Styles"], ["labels", "Labels"], ["countries", "Länder"]] as [Rank, string][]).filter(([k]) => s[k].length > 0);
  const [tab, setTab] = useState<Rank>(tabs[0]?.[0] ?? "styles");
  const rows = s[tab];
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!tabs.length) return null;
  return (
    <div className="card djo-card kc">
      <div className="djo-head">
        <b>Was vorn liegt</b>
        <span className="sub">Platten</span>
      </div>
      {tabs.length > 1 && <Seg value={tab} options={tabs} onChange={setTab} label="Rangliste wählen" />}
      <div className="kc-rank" key={tab}>
        {rows.map((r, i) => {
          const inner = (
            <>
              <span className="kc-rank-name">{r.name}</span>
              <span className="kc-rank-n">{num(r.n)}</span>
              <span className="kc-rank-track">
                <i style={{ transform: `scaleX(${Math.max(0.02, r.n / max)})`, animationDelay: `${i * 40}ms` }} />
              </span>
            </>
          );
          // Labels führen in die Sammlung (die Suche dort kennt Label-Namen)
          return tab === "labels" ? (
            <Link key={r.name} to={`/collection?q=${encodeURIComponent(r.name)}`} viewTransition className="kc-rank-row press">
              {inner}
            </Link>
          ) : (
            <div key={r.name} className="kc-rank-row">
              {inner}
            </div>
          );
        })}
      </div>
      {tab === "styles" && <p className="djo-note">Eine Platte zählt bei jedem ihrer Styles mit.</p>}
    </div>
  );
}

export function KisteCharts() {
  const today = new Date().toISOString().slice(0, 10);
  const data = useLiveQuery(async () => {
    const collection = await db.collection.toArray();
    const rels = (await db.releases.bulkGet([...new Set(collection.map((c) => c.releaseId))])).filter(Boolean);
    return { collection, releases: new Map(rels.map((r) => [r!.id, r!])) };
  }, []);
  const s = useMemo(() => (data ? kisteStats({ ...data, today }) : null), [data, today]);
  // Erst ab ein paar Platten sagen die Bilder etwas
  if (!s || s.total < 3) return null;
  return (
    <section className="djo kc-section">
      <h2>Die Kiste in Bildern</h2>
      {s.growth.length > 1 && <Growth s={s} />}
      {s.calendar.max > 0 && <Calendar s={s} today={today} />}
      {s.years.length > 1 && s.peakYear && <Years s={s} />}
      <Ranks s={s} />
    </section>
  );
}
