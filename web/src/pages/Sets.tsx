import { Pager } from "../components/Pager";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release, type TrackMeta } from "../lib/db";
import { Cover, Empty, Energy, KeyBadge, useDebounced, keyUnsure } from "../components/bits";
import { IconPlus } from "../components/icons";
import { matchesQuery } from "../../../shared/textSearch";
import {
  bpmDelta,
  keyDistance,
  parseKey,
  pitchRange,
} from "../../../shared/music";

export default function Sets() {
  // Kommt man per Wisch von den Freunden, liegt „Nächster Track“ vorn (der Streifen läuft von rechts)
  const startPane = (useLocation().state as { pane?: number } | null)?.pane;
  const [tab, setTab] = useState<"sets" | "live">(startPane === 1 ? "live" : "sets");
  const nav = useNavigate();
  const sets = useLiveQuery(
    () => db.sets.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  // Cover je Set: die Platten der ersten Tracks (sonst aus der Kiste)
  const covers = useLiveQuery(
    async () => {
      const m = new Map<number, string[]>();
      for (const s of sets) {
        const tracks = (
          await db.tracks.bulkGet(s.trackIds.slice(0, 12))
        ).filter(Boolean) as TrackMeta[];
        const ids = [
          ...new Set([
            ...tracks.map((t) => t.releaseId),
            ...(s.crateIds ?? []),
          ]),
        ].slice(0, 4);
        const rels = (await db.releases.bulkGet(ids)).filter(
          Boolean,
        ) as Release[];
        m.set(s.id!, rels.map((r) => r.thumb || r.cover || "").filter(Boolean));
      }
      return m;
    },
    [sets],
    new Map<number, string[]>(),
  );
  const today = new Date().toISOString().slice(0, 10);
  // Kommende Gigs zuerst (nächster oben), dann der Rest, neueste zuerst
  const ordered = [...sets].sort((a, b) => {
    const ua = a.date && a.date >= today ? a.date : null,
      ub = b.date && b.date >= today ? b.date : null;
    if (ua && ub) return ua.localeCompare(ub);
    if (ua || ub) return ua ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return (
    <>
      <div className="page-head">
        <h1>Sets</h1>
        <button
          className="btn small primary"
          onClick={() => nav("/sets/new", { viewTransition: true })}
        >
          <IconPlus /> Neues Set
        </button>
      </div>
      <Pager
        index={tab === "sets" ? 0 : 1}
        onIndex={(i) => setTab(i ? "live" : "sets")}
        labels={["Meine Sets", "Nächster Track"]}
        switchClass="page-switch"
      >
        <div className="page stack">
          <div className="set-grid">
            {ordered.map((s) => {
              const c = covers.get(s.id!) ?? [];
              const upcoming = s.date && s.date >= today;
              return (
                <Link
                  key={s.id}
                  to={`/sets/${s.id}`}
                  viewTransition
                  className="set-tile press"
                >
                  <span className={`set-wall n${Math.min(c.length, 4)}`}>
                    {c.slice(0, 4).map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ))}
                    {c.length === 0 && (
                      <span className="set-count">{s.trackIds.length}</span>
                    )}
                    {upcoming && (
                      <span className="wall-tag set-when">
                        {new Date(s.date!).toLocaleDateString("de-DE", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </span>
                  <b>{s.name || "Ohne Namen"}</b>
                  <span className="sub">
                    {[s.venue, `${s.trackIds.length} Tracks`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              );
            })}
          </div>
          <div>
            {sets.length === 0 && (
              <Empty
                title="Noch keine Sets"
                action={
                  <button
                    className="btn primary"
                    onClick={() => nav("/sets/new", { viewTransition: true })}
                  >
                    Erstes Set planen
                  </button>
                }
              >
                Die App schlägt dir ein Set vor: nach Energie-Verlauf, BPM und
                harmonischen Übergängen.
              </Empty>
            )}
          </div>
        </div>
        <div className="page stack">
          <NextTrack />
        </div>
      </Pager>
    </>
  );
}

/** Live-Helfer: Track wählen, passende nächste Tracks aus der Sammlung anzeigen */
function NextTrack() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 200);
  const [current, setCurrent] = useState<TrackMeta | null>(null);
  const [pitch, setPitch] = useState(8);

  const data = useLiveQuery(async () => {
    const ids = [
      ...new Set((await db.collection.toArray()).map((c) => c.releaseId)),
    ];
    const [tracks, rels] = await Promise.all([
      db.tracks.where("releaseId").anyOf(ids).toArray(),
      db.releases.bulkGet(ids),
    ]);
    return {
      tracks,
      rels: new Map(rels.filter(Boolean).map((r) => [r!.id, r!])),
    };
  });

  const matches = useMemo(() => {
    if (!data || !dq) return [];
    return data.tracks
      .filter((t) =>
        matchesQuery(
          `${t.artist} ${t.title} ${data.rels.get(t.releaseId)?.title}`,
          dq,
        ),
      )
      .slice(0, 20);
  }, [data, dq]);

  const suggestions = useMemo(() => {
    if (!data || !current) return [];
    const ck = parseKey(current.key);
    return data.tracks
      .filter((t) => t.id !== current.id && t.bpm)
      .map((t) => {
        const d = bpmDelta(current.bpm, t.bpm);
        const kd = keyDistance(ck, parseKey(t.key));
        const e = Math.abs((t.energy ?? 5) - (current.energy ?? 5));
        return {
          t,
          d,
          kd,
          score: d * 1.2 + kd * 2 + e * 0.6 - (t.stars ?? 0) * 0.3,
        };
      })
      .filter((x) => x.d <= pitch)
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);
  }, [data, current, pitch]);

  return (
    <div className="stack">
      {current ? (
        <div className="card">
          <div className="sub">Läuft gerade</div>
          <TrackLine t={current} r={data?.rels.get(current.releaseId)} />
          <div className="row">
            <span className="sub">
              {current.bpm
                ? `Pitch-Bereich: ${pitchRange(current.bpm, pitch).join("–")} BPM`
                : "Für Vorschläge braucht der Track BPM"}
            </span>
            <span className="spacer" />
            <select
              className="input"
              style={{ width: 90 }}
              value={pitch}
              onChange={(e) => setPitch(Number(e.target.value))}
            >
              <option value={4}>±4 %</option>
              <option value={6}>±6 %</option>
              <option value={8}>±8 %</option>
              <option value={16}>±16 %</option>
            </select>
            <button
              className="btn small ghost"
              onClick={() => setCurrent(null)}
            >
              ändern
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            className="input"
            placeholder="Welcher Track läuft? (Artist / Titel)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="list">
            {matches.map((t) => (
              <div
                key={t.id}
                onClick={() => setCurrent(t)}
                style={{ cursor: "pointer" }}
              >
                <TrackLine t={t} r={data?.rels.get(t.releaseId)} />
              </div>
            ))}
          </div>
        </>
      )}
      {current && (
        <div className="list">
          {suggestions.map(({ t, d, kd }) => (
            <div
              key={t.id}
              onClick={() => setCurrent(t)}
              style={{ cursor: "pointer" }}
            >
              <TrackLine
                t={t}
                r={data?.rels.get(t.releaseId)}
                extra={
                  <span className="sub">
                    {d.toFixed(1)} % ·{" "}
                    {kd <= 1
                      ? "harmonisch"
                      : kd <= 2
                        ? "Energy-Boost"
                        : "Key-Clash"}
                  </span>
                }
              />
            </div>
          ))}
          {suggestions.length === 0 && (
            <Empty title="Nichts im Pitch-Bereich">
              Pitch-Bereich erweitern oder mehr Tracks mit BPM versehen.
            </Empty>
          )}
        </div>
      )}
    </div>
  );
}

export function TrackLine({
  t,
  r,
  extra,
  actions,
}: {
  t: TrackMeta;
  r?: Release;
  extra?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rec">
      <Cover src={r?.thumb} />
      <div className="rec-main">
        <div className="rec-title">
          <span className="sub">{t.position}</span> {t.title}
        </div>
        <div className="rec-artist">
          {t.artist}
          {r ? ` · ${r.title}` : ""}
        </div>
        {extra}
      </div>
      <div
        className="rec-side stack"
        style={{ gap: 4, alignItems: "flex-end" }}
      >
        <div className="row" style={{ gap: 4 }}>
          {t.bpm ? (
            <span className="bpm">{t.bpm}</span>
          ) : (
            <span className="tiny">BPM?</span>
          )}
          <KeyBadge k={t.key} unsure={keyUnsure(t)} />
        </div>
        <Energy v={t.energy} />
        {actions}
      </div>
    </div>
  );
}
