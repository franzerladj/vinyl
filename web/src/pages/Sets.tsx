import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release, type TrackMeta } from "../lib/db";
import { Cover, Energy, KeyBadge, Seg, useDebounced } from "../components/bits";
import { IconPlus } from "../components/icons";
import { bpmDelta, keyDistance, parseKey, pitchRange } from "../../../shared/music";

export default function Sets() {
  const [tab, setTab] = useState<"sets" | "live">("sets");
  const nav = useNavigate();
  const sets = useLiveQuery(() => db.sets.orderBy("createdAt").reverse().toArray(), [], []);
  return (
    <>
      <div className="page-head">
        <h1>Sets</h1>
        <button className="btn small primary" onClick={() => nav("/sets/new")}>
          <IconPlus /> Neues Set
        </button>
      </div>
      <div className="page stack">
        <Seg
          value={tab}
          options={[
            ["sets", "Meine Sets"],
            ["live", "Was passt als Nächstes?"],
          ]}
          onChange={setTab}
        />
        {tab === "sets" ? (
          <div className="list">
            {sets.map((s) => (
              <Link key={s.id} to={`/sets/${s.id}`} className="rec">
                <div className="rec-main">
                  <div className="rec-title">{s.name}</div>
                  <div className="rec-meta">
                    {s.date && <span>{new Date(s.date).toLocaleDateString("de-DE")}</span>}
                    {s.venue && <span>{s.venue}</span>}
                    <span>{s.trackIds.length} Tracks</span>
                  </div>
                </div>
              </Link>
            ))}
            {sets.length === 0 && (
              <div className="empty">
                Noch keine Sets. Lass dir für deinen nächsten Gig eins vorschlagen: nach Energie-Verlauf, BPM und harmonischen Übergängen.
              </div>
            )}
          </div>
        ) : (
          <NextTrack />
        )}
      </div>
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
    const ids = [...new Set((await db.collection.toArray()).map((c) => c.releaseId))];
    const [tracks, rels] = await Promise.all([db.tracks.where("releaseId").anyOf(ids).toArray(), db.releases.bulkGet(ids)]);
    return { tracks, rels: new Map(rels.filter(Boolean).map((r) => [r!.id, r!])) };
  });

  const matches = useMemo(() => {
    if (!data || !dq) return [];
    return data.tracks.filter((t) => `${t.artist} ${t.title} ${data.rels.get(t.releaseId)?.title}`.toLowerCase().includes(dq)).slice(0, 20);
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
        return { t, d, kd, score: d * 1.2 + kd * 2 + e * 0.6 - (t.stars ?? 0) * 0.3 };
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
              {current.bpm ? `Pitch-Bereich: ${pitchRange(current.bpm, pitch).join("–")} BPM` : "Für Vorschläge braucht der Track BPM"}
            </span>
            <span className="spacer" />
            <select className="input" style={{ width: 90 }} value={pitch} onChange={(e) => setPitch(Number(e.target.value))}>
              <option value={4}>±4 %</option>
              <option value={6}>±6 %</option>
              <option value={8}>±8 %</option>
              <option value={16}>±16 %</option>
            </select>
            <button className="btn small ghost" onClick={() => setCurrent(null)}>
              ändern
            </button>
          </div>
        </div>
      ) : (
        <>
          <input className="input" placeholder="Welcher Track läuft? (Artist / Titel)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="list">
            {matches.map((t) => (
              <div key={t.id} onClick={() => setCurrent(t)} style={{ cursor: "pointer" }}>
                <TrackLine t={t} r={data?.rels.get(t.releaseId)} />
              </div>
            ))}
          </div>
        </>
      )}
      {current && (
        <div className="list">
          {suggestions.map(({ t, d, kd }) => (
            <div key={t.id} onClick={() => setCurrent(t)} style={{ cursor: "pointer" }}>
              <TrackLine t={t} r={data?.rels.get(t.releaseId)} extra={<span className="sub">{d.toFixed(1)} % · {kd <= 1 ? "harmonisch" : kd <= 2 ? "Energy-Boost" : "Key-Clash"}</span>} />
            </div>
          ))}
          {suggestions.length === 0 && <div className="empty">Keine passenden Tracks mit BPM gefunden.</div>}
        </div>
      )}
    </div>
  );
}

export function TrackLine({ t, r, extra, actions }: { t: TrackMeta; r?: Release; extra?: React.ReactNode; actions?: React.ReactNode }) {
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
      <div className="rec-side stack" style={{ gap: 4, alignItems: "flex-end" }}>
        <div className="row" style={{ gap: 4 }}>
          {t.bpm ? <b>{t.bpm}</b> : <span className="sub">–</span>}
          <KeyBadge k={t.key} />
        </div>
        <Energy v={t.energy} />
        {actions}
      </div>
    </div>
  );
}
