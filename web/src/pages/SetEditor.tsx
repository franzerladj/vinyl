import { NavBar } from "../components/ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type DJSet, type TrackMeta } from "../lib/db";
import { toast } from "../lib/store";
import { Seg, Sheet } from "../components/bits";
import { IconBack, IconDown, IconUp, IconX } from "../components/icons";
import { TrackLine } from "./Sets";
import { buildSetlist, targetEnergy, type Curve } from "../../../shared/setlist";
import { estimateBpm, estimateVibe } from "../../../shared/vibes";
import { matchesQuery } from "../../../shared/textSearch";
import { bpmDelta, keyDistance, parseKey } from "../../../shared/music";

const CURVES: [Curve, string, string][] = [
  ["warmup", "Warm-up", "ruhig starten, langsam steigern"],
  ["journey", "Journey", "Aufbau, Peak bei 3/4, kurz runter"],
  ["peak", "Peak-Time", "durchgehend hohe Energie"],
  ["flat", "Bar / Lounge", "gleichmäßig, mittlere Energie"],
  ["closing", "Closing", "vom Peak sanft ausklingen"],
];

export default function SetEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === "new";
  const [set, setSet] = useState<DJSet>({ name: "", curve: "journey", trackIds: [], createdAt: Date.now() });
  const [cfg, setCfg] = useState({ length: 20, startBpm: "", endBpm: "", maxJump: 6, keyWeight: 1, style: "", minStars: 0, onlyWithBpm: false, crate: "", perRecord: 1 });
  const [genNote, setGenNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<"set" | "crate">("set");

  useEffect(() => {
    if (!isNew) db.sets.get(Number(id)).then((s) => s && setSet(s));
  }, [id, isNew]);

  const data = useLiveQuery(async () => {
    const ids = [...new Set((await db.collection.toArray()).map((c) => c.releaseId))];
    const [tracks, rels, metas, coll] = await Promise.all([db.tracks.where("releaseId").anyOf(ids).toArray(), db.releases.bulkGet(ids), db.recordMeta.bulkGet(ids), db.collection.toArray()]);
    return {
      ratings: new Map(coll.map((c) => [c.releaseId, c.rating])),
      tracks,
      byId: new Map(tracks.map((t) => [t.id, t])),
      rels: new Map(rels.filter(Boolean).map((r) => [r!.id, r!])),
      metas: new Map(metas.filter(Boolean).map((m) => [m!.releaseId, m!])),
    };
  });

  const styles = useMemo(() => {
    const c = new Map<string, number>();
    data?.rels.forEach((r) => r.styles.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([s]) => s);
  }, [data]);
  const crates = useMemo(() => [...new Set([...(data?.metas.values() ?? [])].flatMap((m) => m.crates ?? []))], [data]);

  const pool = useMemo(() => {
    if (!data) return [];
    return data.tracks.filter((t) => {
      const r = data.rels.get(t.releaseId);
      if (cfg.onlyWithBpm && !t.bpm) return false;
      if (cfg.style && !r?.styles.includes(cfg.style)) return false;
      if (cfg.minStars && (t.stars ?? 0) < cfg.minStars) return false;
      if (cfg.crate && !data.metas.get(t.releaseId)?.crates?.includes(cfg.crate)) return false;
      return true;
    });
  }, [data, cfg]);

  // Fehlende BPM schätzen (Nachbartracks der Platte oder typisches Tempo des Styles), damit mehr Tracks ins Set passen
  const estBpm = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    const byRel = new Map<number, number[]>();
    data.tracks.forEach((t) => t.bpm && byRel.set(t.releaseId, [...(byRel.get(t.releaseId) ?? []), t.bpm]));
    for (const t of data.tracks) {
      if (t.bpm) continue;
      const e = estimateBpm(data.rels.get(t.releaseId)?.styles ?? [], byRel.get(t.releaseId) ?? []);
      if (e) m.set(t.id, e);
    }
    return m;
  }, [data]);
  const estimatedInSet = set.trackIds.filter((id) => estBpm.has(id)).length;

  const generate = () => {
    if (!pool.length) return toast("Keine Tracks im Pool. Filter lockern oder erst BPM ergänzen.");
    // Qualität: eigene Bewertung (Track-Sterne, sonst Platte) und wie sicher Tempo und Tonart sind
    const quality = (t: (typeof pool)[number]) => {
      const stars = t.stars || data?.ratings.get(t.releaseId) || 0;
      const rating = stars ? stars / 5 : 0.5;
      const bpm = t.bpm ? (t.bpmSource === "Analyse" ? 0.85 : 1) : estBpm.has(t.id) ? 0.35 : 0;
      const key = t.key ? (t.keySource?.startsWith("Analyse") ? 0.6 : 1) : 0;
      return 0.45 * rating + 0.35 * bpm + 0.2 * key;
    };
    const order = buildSetlist(
      pool.map((t) => ({
        id: t.id,
        group: String(t.releaseId),
        quality: quality(t),
        bpm: t.bpm ?? estBpm.get(t.id) ?? null,
        key: t.key ?? null,
        energy: t.energy ?? estimateVibe({ styles: data?.rels.get(t.releaseId)?.styles ?? [], bpm: t.bpm ?? estBpm.get(t.id) }).energy,
      })),
      {
        length: cfg.length,
        curve: set.curve as Curve,
        startBpm: Number(cfg.startBpm) || undefined,
        endBpm: Number(cfg.endBpm) || undefined,
        maxBpmJumpPercent: cfg.maxJump,
        keyWeight: cfg.keyWeight,
        maxPerRecord: cfg.perRecord,
      },
    );
    // Hinweis, wenn Platten mehrfach drin sind oder das Set kürzer wurde
    const perRel = new Map<number, number>();
    order.forEach((id) => {
      const r = data?.byId.get(id)?.releaseId;
      if (r != null) perRel.set(r, (perRel.get(r) ?? 0) + 1);
    });
    const multi = [...perRel.values()].filter((k) => k > 1).length;
    const records = new Set(pool.map((t) => t.releaseId)).size;
    setGenNote(
      multi && cfg.perRecord === 1
        ? `Nur ${records} Platten passen zu den Filtern, deshalb kommen ${multi} Platten zweimal vor (nie direkt hintereinander).`
        : order.length < cfg.length
          ? `Nur ${order.length} Tracks passen zu den Filtern.`
          : null,
    );
    setSet({ ...set, trackIds: order });
  };

  const save = async () => {
    const s = { ...set, name: set.name || `Set ${new Date().toLocaleDateString("de-DE")}` };
    const newId = await db.sets.put(s);
    void import("../lib/push").then((p) => p.syncPushData());
    toast("Set gespeichert");
    if (isNew) nav(`/sets/${newId}`, { replace: true });
    setSet({ ...s, id: newId });
  };

  const move = (i: number, d: number) => {
    const ids = [...set.trackIds];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSet({ ...set, trackIds: ids });
  };

  const tracks = set.trackIds.map((tid) => data?.byId.get(tid)).filter(Boolean) as TrackMeta[];

  const asText = () =>
    `${set.name}${set.date ? ` · ${new Date(set.date).toLocaleDateString("de-DE")}` : ""}${set.venue ? ` · ${set.venue}` : ""}\n\n` +
    tracks.map((t, i) => `${String(i + 1).padStart(2, "0")}. ${t.artist} – ${t.title} [${t.position}]${t.bpm ? ` ${t.bpm} BPM` : ""}${t.key ? ` ${t.key}` : ""}`).join("\n");

  const share = async () => {
    const text = asText();
    if (navigator.share) await navigator.share({ title: set.name, text }).catch(() => undefined);
    else await navigator.clipboard.writeText(text).then(() => toast("Setlist kopiert"));
  };

  // Platten, die für das Set eingepackt werden müssen
  const crateList = useMemo(() => {
    const m = new Map<number, string[]>();
    tracks.forEach((t) => m.set(t.releaseId, [...(m.get(t.releaseId) ?? []), t.position]));
    return [...m.entries()].map(([rid, pos]) => ({ r: data?.rels.get(rid), meta: data?.metas.get(rid), pos })).sort((a, b) => (a.meta?.shelf ?? "~").localeCompare(b.meta?.shelf ?? "~", "de", { numeric: true }));
  }, [tracks, data]);

  const addTrack = (t: TrackMeta) => {
    setSet({ ...set, trackIds: [...set.trackIds, t.id] });
    setAdding(false);
  };

  return (
    <>
      <NavBar
        title={set.name || (isNew ? "Neues Set" : "Set")}
        backTo="/sets"
        backLabel="Sets"
        right={
          <>
            {!isNew && (
              <button
                className="text-btn"
                style={{ color: "var(--bad)", fontWeight: 500 }}
                onClick={async () => {
                  if (!confirm("Set löschen?")) return;
                  await db.sets.delete(Number(id));
                  nav("/sets", { viewTransition: true });
                }}
              >
                Löschen
              </button>
            )}
            <button className="text-btn" onClick={save}>
              Speichern
            </button>
          </>
        }
      />
      <div className="page stack">
        <input className="input" placeholder="Name, z.B. Freitag Klubraum" value={set.name} onChange={(e) => setSet({ ...set, name: e.target.value })} style={{ fontSize: 18, fontWeight: 600 }} />
        <div className="grid2">
          <input className="input" type="date" value={set.date ?? ""} onChange={(e) => setSet({ ...set, date: e.target.value })} />
          <input className="input" placeholder="Location" value={set.venue ?? ""} onChange={(e) => setSet({ ...set, venue: e.target.value })} />
        </div>

        <details className="card" open={set.trackIds.length === 0}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Setlist vorschlagen lassen</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="chips" style={{ flexWrap: "wrap" }}>
              {CURVES.map(([c, l, d]) => (
                <button key={c} className={`chip ${set.curve === c ? "on" : ""}`} onClick={() => setSet({ ...set, curve: c })} title={d}>
                  {l}
                </button>
              ))}
            </div>
            <EnergyCurve curve={set.curve as Curve} actual={tracks.map((t) => t.energy ?? null)} />
            <div className="field" style={{ marginBottom: 10 }}>
              Tracks pro Platte
              <Seg
                value={String(cfg.perRecord) as "1" | "2" | "3"}
                options={[
                  ["1", "Einer"],
                  ["2", "Bis 2"],
                  ["3", "Bis 3"],
                ]}
                onChange={(v) => setCfg({ ...cfg, perRecord: Number(v) })}
              />
              <span className="tiny" style={{ fontWeight: 400 }}>Tracks derselben Platte kommen nie direkt hintereinander. Reichen die Platten nicht, nimmt die App im Notfall mehr.</span>
            </div>
            <div className="grid3">
              <label className="field">
                Tracks
                <input className="input" inputMode="numeric" value={cfg.length} onChange={(e) => setCfg({ ...cfg, length: Number(e.target.value) || 0 })} />
              </label>
              <label className="field">
                Start-BPM
                <input className="input" inputMode="numeric" placeholder="frei" value={cfg.startBpm} onChange={(e) => setCfg({ ...cfg, startBpm: e.target.value })} />
              </label>
              <label className="field">
                End-BPM
                <input className="input" inputMode="numeric" placeholder="frei" value={cfg.endBpm} onChange={(e) => setCfg({ ...cfg, endBpm: e.target.value })} />
              </label>
              <label className="field">
                max. BPM-Sprung
                <select className="input" value={cfg.maxJump} onChange={(e) => setCfg({ ...cfg, maxJump: Number(e.target.value) })}>
                  {[3, 4, 6, 8, 12].map((v) => (
                    <option key={v} value={v}>
                      {v} %
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Harmonie
                <select className="input" value={cfg.keyWeight} onChange={(e) => setCfg({ ...cfg, keyWeight: Number(e.target.value) })}>
                  <option value={0}>egal</option>
                  <option value={1}>wichtig</option>
                  <option value={2}>sehr wichtig</option>
                </select>
              </label>
              <label className="field">
                min. Sterne
                <select className="input" value={cfg.minStars} onChange={(e) => setCfg({ ...cfg, minStars: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      {v || "alle"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid2">
              <select className="input" value={cfg.style} onChange={(e) => setCfg({ ...cfg, style: e.target.value })}>
                <option value="">Alle Styles</option>
                {styles.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select className="input" value={cfg.crate} onChange={(e) => setCfg({ ...cfg, crate: e.target.value })}>
                <option value="">Ganze Sammlung</option>
                {crates.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <label className="row sub">
              <input type="checkbox" checked={cfg.onlyWithBpm} onChange={(e) => setCfg({ ...cfg, onlyWithBpm: e.target.checked })} /> nur Tracks mit gemessenem BPM (sonst wird fehlendes Tempo aus Platte und Style geschätzt)
            </label>
            <button className="btn primary" onClick={generate}>
              Vorschlag erstellen ({new Set(pool.map((t) => t.releaseId)).size} Platten, {pool.length} Tracks)
            </button>
            {genNote && <span className="sub" style={{ color: "var(--warn)" }}>{genNote}</span>}
            <span className="sub">Pro Platte wählt die App den Track, der am besten passt: nach Tempo, Tonart, Energie und deiner Bewertung. Gemessene Werte schlagen geschätzte.{estimatedInSet > 0 ? ` Im aktuellen Set sind ${estimatedInSet} Tempi geschätzt (mit ~ markiert).` : ""}</span>
          </div>
        </details>

        {tracks.length > 0 && (
          <div className="row">
            <Seg
              value={view}
              options={[
                ["set", `Reihenfolge (${tracks.length})`],
                ["crate", `Einpacken (${crateList.length})`],
              ]}
              onChange={setView}
            />
            <span className="spacer" />
            <button className="btn small ghost" onClick={share}>
              Teilen
            </button>
          </div>
        )}

        {view === "set" ? (
          <div className="list">
            {tracks.map((t, i) => {
              const prev = tracks[i - 1];
              const d = prev ? bpmDelta(prev.bpm, t.bpm) : 0;
              const kd = prev ? keyDistance(parseKey(prev.key), parseKey(t.key)) : 0;
              return (
                <div key={t.id}>
                  {prev && (
                    <div className="transition">
                      <span className="dot" style={{ background: d <= 3 ? "var(--ok)" : d <= 6 ? "var(--warn)" : "var(--bad)" }} />
                      {prev.bpm && t.bpm ? (Math.round(t.bpm) === Math.round(prev.bpm) ? "gleiches Tempo" : `${t.bpm > prev.bpm ? "+" : ""}${(t.bpm - prev.bpm).toFixed(0)} BPM (${d.toFixed(1).replace(".", ",")} %)`) : "BPM ?"}
                      <span className="dot" style={{ background: kd <= 1 ? "var(--ok)" : kd <= 2 ? "var(--warn)" : "var(--bad)" }} />
                      {kd <= 1 ? "harmonisch" : kd <= 2 ? "Energy-Boost" : prev.key && t.key ? "Key-Clash" : "Key ?"}
                    </div>
                  )}
                  <TrackLine
                    t={t}
                    r={data?.rels.get(t.releaseId)}
                    extra={
                      <span className="sub">
                        #{i + 1}
                        {!t.bpm && estBpm.has(t.id) ? ` · ~${estBpm.get(t.id)} BPM geschätzt` : ""}
                      </span>
                    }
                    actions={
                      <div className="mini-actions">
                        <button className="icon-btn" onClick={() => move(i, -1)} aria-label="hoch">
                          <IconUp />
                        </button>
                        <button className="icon-btn" onClick={() => move(i, 1)} aria-label="runter">
                          <IconDown />
                        </button>
                        <button className="icon-btn" onClick={() => setSet({ ...set, trackIds: set.trackIds.filter((x) => x !== t.id) })} aria-label="entfernen">
                          <IconX />
                        </button>
                      </div>
                    }
                  />
                </div>
              );
            })}
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
              + Track hinzufügen
            </button>
          </div>
        ) : (
          <div className="list">
            {crateList.map(({ r, meta, pos }) =>
              r ? (
                <div key={r.id} className="rec">
                  <img className="cover" src={r.thumb} alt="" />
                  <div className="rec-main">
                    <div className="rec-title">{r.title}</div>
                    <div className="rec-artist">{r.artist}</div>
                    <div className="rec-meta">
                      <span>{r.labels[0]?.catno}</span>
                      <span>Tracks: {pos.join(", ")}</span>
                    </div>
                  </div>
                  <div className="rec-side">{meta?.shelf ? <span className="badge accent">{meta.shelf}</span> : <span className="sub">kein Regalplatz</span>}</div>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)}>
        <AddTrack tracks={data?.tracks ?? []} rels={data?.rels} last={tracks[tracks.length - 1]} onPick={addTrack} exclude={new Set(set.trackIds)} />
      </Sheet>
    </>
  );
}

function AddTrack({ tracks, rels, last, onPick, exclude }: { tracks: TrackMeta[]; rels?: Map<number, import("../lib/db").Release>; last?: TrackMeta; onPick: (t: TrackMeta) => void; exclude: Set<string> }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const lq = q.toLowerCase();
    let l = tracks.filter((t) => !exclude.has(t.id));
    if (lq) l = l.filter((t) => matchesQuery(`${t.artist} ${t.title} ${rels?.get(t.releaseId)?.title}`, lq));
    else if (last) l = [...l].sort((a, b) => bpmDelta(last.bpm, a.bpm) + keyDistance(parseKey(last.key), parseKey(a.key)) * 2 - (bpmDelta(last.bpm, b.bpm) + keyDistance(parseKey(last.key), parseKey(b.key)) * 2));
    return l.slice(0, 40);
  }, [q, tracks, rels, last, exclude]);
  return (
    <div className="stack">
      <input className="input" placeholder={last ? "Suchen oder Vorschläge nach dem letzten Track" : "Track suchen"} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {list.map((t) => (
          <div key={t.id} onClick={() => onPick(t)} style={{ cursor: "pointer" }}>
            <TrackLine t={t} r={rels?.get(t.releaseId)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EnergyCurve({ curve, actual }: { curve: Curve; actual: (number | null)[] }) {
  const W = 300;
  const H = 60;
  const pts = Array.from({ length: 31 }, (_, i) => i / 30).map((t) => `${t * W},${H - (targetEnergy(curve, t) / 10) * H}`);
  const act = actual.map((e, i) => (e == null ? null : `${(i / Math.max(1, actual.length - 1)) * W},${H - (e / 10) * H}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 60 }} aria-label="Energie-Kurve">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--text-3)" strokeDasharray="4 4" strokeWidth="2" />
      {act.length > 1 && <polyline points={act.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" />}
    </svg>
  );
}
