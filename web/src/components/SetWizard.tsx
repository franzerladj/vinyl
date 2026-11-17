// Neues Set in drei Fragen: Wo und wann, wie soll es klingen, wie willst du bauen.
// Danach steht im Editor schon ein Vorschlag (oder die leere Kiste zum Selberpacken).
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type DJSet } from "../lib/db";
import { useFolders } from "../lib/folders";
import { NavBar } from "./ui";
import { haptic, useRootClass } from "./bits";
import { IconCheck } from "./icons";
import { targetEnergy, type Curve } from "../../../shared/setlist";

export interface WizardResult {
  patch: Partial<DJSet>;
  /** Anzahl Tracks für den Vorschlag, null = selbst zusammenstellen */
  autofill: number | null;
}

const CURVES: [Curve, string, string][] = [
  ["warmup", "Warm-up", "Ruhig anfangen, langsam steigern"],
  ["journey", "Journey", "Aufbau, Höhepunkt bei drei Vierteln, kurz runter"],
  ["peak", "Peak-Time", "Durchgehend Druck"],
  ["flat", "Bar und Lounge", "Gleichmäßig, mittlere Energie"],
  ["closing", "Closing", "Vom Höhepunkt sanft ausklingen"],
];
const HOURS = [1, 1.5, 2, 3, 4];
const TRACKS_PER_HOUR = 12;

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function dayChips(now = new Date()): [string, string][] {
  const out: [string, string][] = [
    ["Heute", iso(now)],
    ["Morgen", iso(new Date(now.getTime() + 864e5))],
  ];
  // Nächster Freitag und Samstag (nicht heute oder morgen doppelt)
  for (const [label, wd] of [["Freitag", 5], ["Samstag", 6]] as const) {
    const d = new Date(now);
    d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
    const v = iso(d);
    if (!out.some(([, x]) => x === v)) out.push([label, v]);
  }
  return out;
}

const addMinutes = (hhmm: string, min: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (((h * 60 + m + min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

function CurveIcon({ curve }: { curve: Curve }) {
  const W = 72, H = 36;
  const pts = Array.from({ length: 25 }, (_, i) => i / 24).map((t) => `${4 + t * (W - 8)},${H - 3 - (targetEnergy(curve, t) / 10) * (H - 8)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="wiz-curve" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SetWizard({ initial, onDone, onSkip }: { initial: DJSet; onDone: (r: WizardResult) => void; onSkip: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial.name);
  const [venue, setVenue] = useState(initial.venue ?? "");
  const [date, setDate] = useState(initial.date ?? "");
  const [start, setStart] = useState(initial.start ?? "");
  const [hours, setHours] = useState(2);
  const [curve, setCurve] = useState<Curve>((initial.curve as Curve) || "journey");
  const [styles, setStyles] = useState<string[]>([]);
  const [folderId, setFolderId] = useState<number | undefined>(initial.folderId);
  const folders = useFolders();
  // Die Sync-Anzeige läge sonst über dem Knopf „Weiter“
  useRootClass("in-wiz", true);
  const days = useMemo(() => dayChips(), []);

  // Sammlung für die Auswahl: Styles nach Häufigkeit, Platten je Ordner
  const lib = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    const rels = await db.releases.bulkGet([...new Set(coll.map((c) => c.releaseId))]);
    const folderOf = coll.reduce((m, c) => m.set(c.releaseId, [...(m.get(c.releaseId) ?? []), c.folderId]), new Map<number, number[]>());
    return rels.filter(Boolean).map((r) => ({ id: r!.id, styles: r!.styles, folders: folderOf.get(r!.id) ?? [] }));
  }, []);
  const inFolder = useMemo(() => (lib ?? []).filter((r) => !folderId || r.folders.includes(folderId)), [lib, folderId]);
  const topStyles = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inFolder) for (const s of r.styles) m.set(s, (m.get(s) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [inFolder]);
  const matching = inFolder.filter((r) => !styles.length || r.styles.some((s) => styles.includes(s))).length;
  const count = Math.round(hours * TRACKS_PER_HOUR);

  const patch = (): Partial<DJSet> => ({
    name: name.trim(),
    venue: venue.trim() || undefined,
    date: date || undefined,
    start: date && start ? start : undefined,
    end: date && start ? addMinutes(start, hours * 60) : undefined,
    curve,
    folderId,
    styles: styles.length ? styles : undefined,
  });
  const next = () => {
    haptic(6);
    setStep((s) => Math.min(2, s + 1));
    window.scrollTo(0, 0);
  };
  const toggleStyle = (s: string) => {
    haptic(4);
    setStyles((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };
  const hoursText = (h: number) => (h === 1 ? "1 Stunde" : h === 1.5 ? "1½ Stunden" : `${h} Stunden`);

  return (
    <>
      <NavBar
        title="Neues Set"
        backTo="/sets"
        backLabel="Sets"
        right={
          <button className="text-btn" onClick={onSkip}>
            Überspringen
          </button>
        }
      />
      <div className="page wiz">
        <div className="wiz-steps" aria-label={`Schritt ${step + 1} von 3`}>
          {[0, 1, 2].map((i) => (
            <button key={i} className={i <= step ? "on" : ""} onClick={() => i < step && setStep(i)} aria-label={`Schritt ${i + 1}`} disabled={i >= step} />
          ))}
        </div>

        {step === 0 && (
          <section className="wiz-step" key="s0">
            <h1 className="wiz-q">Wo legst du auf?</h1>
            <p className="sub">Alles freiwillig. Mit Datum landet der Gig oben auf deiner Startseite und auf Wunsch im Kalender.</p>
            <input className="input wiz-big" placeholder="Name, z. B. Freitag im Klubraum" value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="next" />
            <input className="input" placeholder="Ort" value={venue} onChange={(e) => setVenue(e.target.value)} enterKeyHint="done" />
            <span className="wiz-label">Wann?</span>
            <div className="chips">
              <button className={`chip ${!date ? "on" : ""}`} onClick={() => setDate("")}>
                Noch offen
              </button>
              {days.map(([l, v]) => (
                <button key={v} className={`chip ${date === v ? "on" : ""}`} onClick={() => setDate(v)}>
                  {l}
                </button>
              ))}
              <label className={`chip wiz-date ${date && !days.some(([, v]) => v === date) ? "on" : ""}`}>
                {date && !days.some(([, v]) => v === date) ? new Date(date).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "Anderer Tag"}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Datum wählen" />
              </label>
            </div>
            {date && (
              <label className="wiz-time">
                <span className="wiz-label">Beginn</span>
                <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
            )}
            <span className="wiz-label">Wie lange spielst du?</span>
            <div className="chips">
              {HOURS.map((h) => (
                <button key={h} className={`chip ${hours === h ? "on" : ""}`} onClick={() => setHours(h)}>
                  {hoursText(h)}
                </button>
              ))}
            </div>
            <span className="tiny sub">Das sind etwa {count} Tracks.</span>
          </section>
        )}

        {step === 1 && (
          <section className="wiz-step" key="s1">
            <h1 className="wiz-q">Wie soll der Abend laufen?</h1>
            <div className="wiz-curves">
              {CURVES.map(([c, l, d]) => (
                <button key={c} className={`wiz-card press ${curve === c ? "on" : ""}`} onClick={() => (haptic(5), setCurve(c))} aria-pressed={curve === c}>
                  <CurveIcon curve={c} />
                  <span>
                    <b>{l}</b>
                    <small>{d}</small>
                  </span>
                  {curve === c && <IconCheck />}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="wiz-step" key="s2">
            <h1 className="wiz-q">Welche Platten kommen mit?</h1>
            {folders.length > 0 && (
              <>
                <span className="wiz-label">Aus welchem Ordner?</span>
                <div className="chips">
                  <button className={`chip ${!folderId ? "on" : ""}`} onClick={() => setFolderId(undefined)}>
                    Ganze Sammlung
                  </button>
                  {folders.map((f) => (
                    <button key={f.id} className={`chip ${folderId === f.id ? "on" : ""}`} onClick={() => setFolderId(f.id)}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {topStyles.length > 0 && (
              <>
                <span className="wiz-label">Welche Richtung? Nichts gewählt heißt alles.</span>
                <div className="chips">
                  {topStyles.map(([s, n]) => (
                    <button key={s} className={`chip ${styles.includes(s) ? "on" : ""}`} onClick={() => toggleStyle(s)}>
                      {s} <span className="chip-n">{n}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="wiz-sum">
              <b>{matching}</b> {matching === 1 ? "Platte passt" : "Platten passen"} · etwa <b>{count}</b> Tracks für {hoursText(hours)}
            </div>
          </section>
        )}
      </div>

      <div className="wiz-foot no-print">
        {step < 2 ? (
          <button className="btn primary block lg" onClick={next}>
            Weiter
          </button>
        ) : (
          <>
            <button className="btn primary block lg" disabled={matching === 0} onClick={() => (haptic(12), onDone({ patch: patch(), autofill: count }))}>
              Vorschlag bauen lassen
            </button>
            <button className="btn block lg ghost" onClick={() => onDone({ patch: patch(), autofill: null })}>
              Ich stelle selbst zusammen
            </button>
          </>
        )}
      </div>
    </>
  );
}
