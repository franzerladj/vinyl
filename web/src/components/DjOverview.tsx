// „Deine Kiste als DJ“: beantwortet konkrete Fragen statt Prozent-Ringen.
// Wie viel ist mixbereit? In welchem Tempo, welchen Tonarten, welcher Energie liegt die Kiste?
// Jede Zahl führt per Tipp zu den passenden Platten.
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { camelotString, parseKey } from "../../../shared/music";
import { slotFor } from "../../../shared/vibes";
import { CAMELOT_COLORS, haptic } from "./bits";

const LO = 85;
const HI = 150;
const STEP = 5;

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export function DjOverview() {
  const nav = useNavigate();
  const running = useStore((s) => Object.keys(s.jobs).length > 0);
  const d = useLiveQuery(async () => {
    const ids = new Set((await db.collection.toArray()).map((c) => c.releaseId));
    const tracks = (await db.tracks.where("releaseId").anyOf([...ids]).toArray()).filter((t) => t.title);
    const byRelease = new Map<number, typeof tracks>();
    tracks.forEach((t) => byRelease.set(t.releaseId, [...(byRelease.get(t.releaseId) ?? []), t]));
    const withBpm = tracks.filter((t) => t.bpm);
    const measured = withBpm.filter((t) => t.bpmSource === "Analyse").length;
    const missing = tracks.filter((t) => !t.bpm);
    const searching = missing.filter((t) => !t.lookedUpAt || !t.analyzedAt).length;
    const withKey = tracks.filter((t) => t.key);
    const keyMeasured = withKey.filter((t) => t.keySource?.startsWith("Analyse")).length;
    // Tempo-Histogramm
    const buckets = Array.from({ length: (HI - LO) / STEP }, (_, i) => ({ from: LO + i * STEP, n: 0 }));
    let below = 0;
    let above = 0;
    for (const t of withBpm) {
      const b = t.bpm!;
      if (b < LO) below++;
      else if (b >= HI) above++;
      else buckets[Math.floor((b - LO) / STEP)].n++;
    }
    // Tonarten nach Camelot
    const keys = new Map<string, number>();
    for (const t of withKey) {
      const c = camelotString(parseKey(t.key));
      if (c) keys.set(c, (keys.get(c) ?? 0) + 1);
    }
    // Energie
    const slots = { warmup: 0, build: 0, peak: 0 };
    for (const t of tracks) if (t.energy != null) slots[slotFor(t.energy) as keyof typeof slots]++;
    const recordsMissing = [...byRelease.values()].filter((ts) => ts.some((t) => !t.bpm)).length;
    return { total: tracks.length, withBpm: withBpm.length, measured, missing: missing.length, searching, withKey: withKey.length, keyMeasured, buckets, below, above, keys, slots, recordsMissing };
  });

  if (!d || !d.total) return null;
  const go = (path: string) => {
    haptic(6);
    nav(path, { viewTransition: true });
  };
  const sure = d.withBpm - d.measured;
  const maxB = Math.max(1, ...d.buckets.map((b) => b.n));
  const peak = d.buckets.reduce((a, b) => (b.n > a.n ? b : a), d.buckets[0]);
  const bpms = d.buckets.filter((b) => b.n > 0);
  const topKey = [...d.keys.entries()].sort((a, b) => b[1] - a[1])[0];
  const energyTotal = d.slots.warmup + d.slots.build + d.slots.peak;

  return (
    <section className="djo">
      <h2>Deine Kiste als DJ</h2>

      {/* 1. Mixbereit */}
      <div className="card djo-card">
        <div className="djo-big">
          <b>{d.withBpm}</b>
          <span>von {d.total} Tracks haben ein Tempo</span>
        </div>
        <div className="djo-bar" role="img" aria-label={`${sure} sicher, ${d.measured} gemessen, ${d.missing} fehlen`}>
          <i style={{ flex: sure, background: "var(--accent)" }} />
          <i style={{ flex: d.measured, background: "color-mix(in srgb, var(--accent) 45%, transparent)" }} />
          <i style={{ flex: d.missing, background: "var(--surface-3)" }} />
        </div>
        <div className="djo-legend">
          {sure > 0 && (
            <span>
              <i style={{ background: "var(--accent)" }} /> {sure} aus Datenbanken
            </span>
          )}
          {d.measured > 0 && (
            <span>
              <i style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }} /> {d.measured} aus der Hörprobe gemessen
            </span>
          )}
          {d.missing > 0 && (
            <span>
              <i style={{ background: "var(--surface-3)" }} /> {d.missing} fehlen
            </span>
          )}
        </div>
        <p className="djo-note">
          {d.withKey} Tracks haben eine Tonart{d.keyMeasured ? `, davon ${d.keyMeasured} gemessen (nach Gehör prüfen)` : ""}.
          {d.missing > 0 &&
            (running && d.searching > 0
              ? ` ${d.searching} werden gerade noch gesucht.`
              : " Für den Rest gibt es online keine Hörprobe, das ist bei seltenen Pressungen normal.")}
        </p>
        {d.recordsMissing > 0 && (
          <button className="djo-action press" onClick={() => go("/collection?nobpm=1")}>
            <span>
              <b>{d.recordsMissing} Platten ergänzen</b>
              <small>Track antippen, Video läuft, im Takt auf TAP tippen</small>
            </span>
            <span className="chev">›</span>
          </button>
        )}
      </div>

      {/* 2. Tempo */}
      {bpms.length > 0 && (
        <div className="card djo-card">
          <div className="djo-head">
            <b>Tempo</b>
            <span className="sub">
              Schwerpunkt {peak.from}–{peak.from + STEP - 1} BPM
            </span>
          </div>
          <div className="djo-hist">
            {d.buckets.map((b) => (
              <button
                key={b.from}
                className={b === peak ? "top" : ""}
                disabled={!b.n}
                onClick={() => go(`/collection?bpm=${b.from}-${b.from + STEP - 1}`)}
                aria-label={`${b.n} Tracks mit ${b.from} bis ${b.from + STEP - 1} BPM`}
              >
                <i style={{ height: `${Math.max(b.n ? 6 : 2, (b.n / maxB) * 100)}%` }} />
              </button>
            ))}
          </div>
          <div className="djo-axis">
            <span>{LO}</span>
            <span>100</span>
            <span>120</span>
            <span>{HI}</span>
          </div>
          <p className="djo-note">
            Tippe auf einen Balken, um die Platten in diesem Tempo zu sehen.
            {d.below + d.above > 0 ? ` ${d.below ? `${d.below} langsamer als ${LO}` : ""}${d.below && d.above ? ", " : ""}${d.above ? `${d.above} schneller als ${HI}` : ""}.` : ""}
          </p>
        </div>
      )}

      {/* 3. Tonarten */}
      {d.keys.size > 0 && (
        <div className="card djo-card">
          <div className="djo-head">
            <b>Tonarten</b>
            {topKey && <span className="sub">am häufigsten {topKey[0]}</span>}
          </div>
          <div className="djo-wheel-wrap">
            <CamelotWheel counts={d.keys} onPick={(k) => go(`/collection?key=${k}`)} />
            <p className="djo-note" style={{ margin: 0 }}>
              Innen Moll (A), außen Dur (B). Nachbarfelder passen harmonisch zusammen. Tippe auf ein Feld für alle Platten, die dazu passen.
            </p>
          </div>
        </div>
      )}

      {/* 4. Energie */}
      {energyTotal > 0 && (
        <div className="card djo-card">
          <div className="djo-head">
            <b>Energie</b>
            <span className="sub">für den Ablauf deiner Sets</span>
          </div>
          <div className="djo-energy">
            {(
              [
                ["warmup", "Warm-up", "#64d2ff"],
                ["build", "Aufbau", "#ffd60a"],
                ["peak", "Peak", "#ff453a"],
              ] as const
            ).map(([k, l, c]) => (
              <div key={k} style={{ flex: Math.max(1, d.slots[k]) }}>
                <i style={{ background: c }} />
                <b>{pct(d.slots[k], energyTotal)} %</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <p className="djo-note">{energyHint(d.slots, energyTotal)}</p>
        </div>
      )}
    </section>
  );
}

function energyHint(s: { warmup: number; build: number; peak: number }, total: number) {
  const p = (n: number) => n / total;
  if (p(s.peak) < 0.12) return "Wenig für die Peak-Time. Für späte Sets lohnt es sich, gezielt nach treibenden Platten zu diggen.";
  if (p(s.warmup) < 0.12) return "Kaum ruhige Platten für den Anfang. Für Warm-ups fehlt dir noch Material.";
  if (p(s.build) > 0.6) return "Deine Kiste ist stark im mittleren Bereich, gut für lange Sets mit sanften Übergängen.";
  return "Gut gemischt: genug für Warm-up, Aufbau und Höhepunkt.";
}

/** Camelot-Rad: 12 oben, innen Moll, außen Dur. Deckkraft nach Anzahl. */
function CamelotWheel({ counts, onPick }: { counts: Map<string, number>; onPick: (k: string) => void }) {
  const max = Math.max(1, ...counts.values());
  const size = 168;
  const c = size / 2;
  const seg = (num: number, r0: number, r1: number) => {
    const a0 = ((num * 30 - 15 - 90) * Math.PI) / 180;
    const a1 = ((num * 30 + 15 - 90) * Math.PI) / 180;
    const p = (r: number, a: number) => `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
    return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`;
  };
  const label = (num: number, r: number) => {
    const a = ((num * 30 - 90) * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };
  return (
    <svg className="djo-wheel" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="group" aria-label="Camelot-Rad">
      {Array.from({ length: 12 }, (_, i) => i + 1).flatMap((num) =>
        (["A", "B"] as const).map((letter) => {
          const k = `${num}${letter}`;
          const n = counts.get(k) ?? 0;
          const [r0, r1] = letter === "A" ? [34, 58] : [60, 82];
          const l = label(num, (r0 + r1) / 2);
          return (
            <g key={k} onClick={() => n && onPick(k)} style={{ cursor: n ? "pointer" : "default" }} role="button" aria-label={`${k}: ${n} Tracks`}>
              <path d={seg(num, r0, r1)} fill={CAMELOT_COLORS[num - 1]} opacity={n ? 0.25 + 0.75 * (n / max) : 0.08} stroke="var(--bg)" strokeWidth="1.5" />
              <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="700" fill={n ? "#111" : "var(--text-3)"}>
                {k}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}
