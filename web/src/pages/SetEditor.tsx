// Set kuratieren: Kiste packen, Reihenfolge selbst bauen, „Was passt danach?“ mit Begründung,
// Mix-Notizen, Reinhören, Live-Modus. Die Automatik ist nur noch eine Hilfe, kein Ersatz.
import { MenuSheet, NavBar } from "../components/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getKV, type DJSet, type Release, type TrackMeta } from "../lib/db";
import { ShareCardSheet } from "../components/ShareCard";
import { renderSetCard } from "../lib/shareCard";
import { encodeSet } from "../../../shared/setShare";
import { playedHistory, playedText, type PlayedAt } from "../lib/setHistory";
import { ask, toast, username } from "../lib/store";
import { deleteTemplate, saveTemplate, stillOwned, useTemplates } from "../lib/crateTemplates";
import { Cover, haptic, Seg, Sheet, keepParens } from "../components/bits";
import { IconPlay, IconPlus, IconX } from "../components/icons";
import { TrackLine } from "./Sets";
import { previewUrl } from "../lib/free";
import { buildSetlist, setStats, suggestNext, targetEnergy, type Curve, type SetTrack, type Suggestion } from "../../../shared/setlist";
import { estimateBpm, estimateVibe } from "../../../shared/vibes";
import { matchesQuery } from "../../../shared/textSearch";
import { bpmDelta, keyDistance, parseKey } from "../../../shared/music";
import { parseDuration } from "../../../shared/match";
import { Hint } from "../components/Welcome";
import { CalendarSheet } from "../components/CalendarSheet";
import type { GigEvent } from "../../../shared/ics";
import { useFolders } from "../lib/folders";

/** Zuletzt gewählter Ordner gilt für das nächste neue Set */
const lastFolder = () => {
  try {
    return Number(localStorage.getItem("crate:set-folder")) || undefined;
  } catch {
    return undefined;
  }
};

const CURVES: [Curve, string, string][] = [
  ["warmup", "Warm-up", "ruhig starten, langsam steigern"],
  ["journey", "Journey", "Aufbau, Peak bei 3/4, kurz runter"],
  ["peak", "Peak-Time", "durchgehend hohe Energie"],
  ["flat", "Bar / Lounge", "gleichmäßig, mittlere Energie"],
  ["closing", "Closing", "vom Peak sanft ausklingen"],
];

type Data = {
  tracks: TrackMeta[];
  byId: Map<string, TrackMeta>;
  rels: Map<number, Release>;
  metas: Map<number, { shelf?: string; crates?: string[] }>;
  ratings: Map<number, number>;
  /** Discogs-Ordner je Platte (alle Exemplare) */
  folders: Map<number, number[]>;
};

export default function SetEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === "new";
  const [set, setSet] = useState<DJSet>({ name: "", curve: "journey", trackIds: [], createdAt: Date.now(), crateIds: [], mixNotes: {}, folderId: lastFolder() });
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"order" | "crate">("order");
  const [picker, setPicker] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const templates = useTemplates();
  const [auto, setAuto] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [wide, setWide] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [shareMenu, setShareMenu] = useState(false);
  const [card, setCard] = useState(false);
  const allSets = useLiveQuery(() => db.sets.toArray(), [], []);
  const history = useMemo(() => playedHistory(allSets, set.id), [allSets, set.id]);
  const djName = useLiveQuery(async () => (await getKV<{ djName?: string } | null>("crateProfile:me", null))?.djName ?? (await getKV<{ name?: string } | null>("myProfile", null))?.name);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!isNew) db.sets.get(Number(id)).then((s) => s && setSet({ crateIds: [], mixNotes: {}, ...s }));
  }, [id, isNew]);

  const [calOpen, setCalOpen] = useState(false);
  const gigEvent: GigEvent | null = set.date
    ? {
        uid: `set-${set.id ?? "neu"}-${set.createdAt}@crate`,
        title: set.venue ? `${set.name || "Gig"} · ${set.venue}` : set.name || "Gig",
        date: set.date,
        start: set.start,
        end: set.end,
        location: set.venue,
        description: [`Set in Crate: ${set.trackIds.length} Tracks${set.crateIds?.length ? `, ${set.crateIds.length} Platten in der Kiste` : ""}`, set.notes, set.id ? `${location.origin}/sets/${set.id}` : ""].filter(Boolean).join("\n"),
        alarmMinutes: 180,
      }
    : null;
  const update = (patch: Partial<DJSet>) => {
    setSet((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const data = useLiveQuery(async (): Promise<Data> => {
    const coll = await db.collection.toArray();
    const ids = [...new Set(coll.map((c) => c.releaseId))];
    const [tracks, rels, metas] = await Promise.all([db.tracks.where("releaseId").anyOf(ids).toArray(), db.releases.bulkGet(ids), db.recordMeta.bulkGet(ids)]);
    return {
      tracks,
      byId: new Map(tracks.map((t) => [t.id, t])),
      rels: new Map(rels.filter(Boolean).map((r) => [r!.id, r!])),
      metas: new Map(metas.filter(Boolean).map((m) => [m!.releaseId, m!])),
      ratings: new Map(coll.map((c) => [c.releaseId, c.rating])),
      folders: coll.reduce((m, c) => m.set(c.releaseId, [...(m.get(c.releaseId) ?? []), c.folderId]), new Map<number, number[]>()),
    };
  });

  // Fehlendes Tempo schätzen (andere Tracks der Platte oder typisches Tempo des Styles)
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

  /** Track in die Form für Vorschläge und Ordnen bringen: mit Platte, Schätzwerten und Qualität */
  const toSetTrack = (t: TrackMeta): SetTrack => {
    const stars = t.stars || data?.ratings.get(t.releaseId) || 0;
    // Unsicheres Tempo zählt bei Vorschlägen weniger, gegengeprüftes voll
    const bpmQ = t.bpm ? (t.tempoCheck === "unsicher" ? 0.4 : t.tempoCheck === "sicher" ? 1 : 0.85) : estBpm.has(t.id) ? 0.35 : 0;
    const keyQ = t.key ? (t.keySource?.startsWith("Analyse") ? 0.6 : 1) : 0;
    const bpm = t.bpm ?? estBpm.get(t.id) ?? null;
    return {
      id: t.id,
      group: String(t.releaseId),
      bpm,
      key: t.key ?? null,
      energy: t.energy ?? estimateVibe({ styles: data?.rels.get(t.releaseId)?.styles ?? [], bpm: bpm ?? undefined }).energy,
      quality: 0.45 * (stars ? stars / 5 : 0.5) + 0.35 * bpmQ + 0.2 * keyQ,
    };
  };

  const tracks = set.trackIds.map((tid) => data?.byId.get(tid)).filter(Boolean) as TrackMeta[];
  const seq = useMemo(() => tracks.map(toSetTrack), [tracks, data, estBpm]); // eslint-disable-line react-hooks/exhaustive-deps
  const crate = set.crateIds ?? [];
  const crateSet = new Set(crate);
  // Quelle: ganze Sammlung oder ein Ordner (z. B. nur Platten zum Auflegen)
  const folders = useFolders();
  const folderId = set.folderId && folders.some((f) => f.id === set.folderId) ? set.folderId : undefined;
  const folderName = folders.find((f) => f.id === folderId)?.name;
  const fromSource = (rid: number) => !folderId || Boolean(data?.folders.get(rid)?.includes(folderId));
  const chooseFolder = (id?: number) => {
    update({ folderId: id });
    try {
      if (id) localStorage.setItem("crate:set-folder", String(id));
      else localStorage.removeItem("crate:set-folder");
    } catch {
      /* egal */
    }
  };
  const stats = setStats(seq);
  const durOf = (t: TrackMeta) => parseDuration(data?.rels.get(t.releaseId)?.tracklist?.find((x) => x.position === t.position)?.duration);
  // Beim Mixen überlappen Tracks: grob 80 % der Länge, nur der letzte läuft ganz
  const minutes = Math.round(tracks.reduce((s, t, i) => s + (durOf(t) ?? 360) * (i < tracks.length - 1 ? 0.8 : 1), 0) / 60);

  /** Vorschläge für die Stelle nach `index` (−1 = Anfang) */
  const suggestionsAt = (index: number): Suggestion[] => {
    if (!data) return [];
    const prev = index >= 0 ? seq[index] : null;
    const used = new Set(seq.map((t) => t.group!));
    const pool = (wide || !crate.length ? data.tracks.filter((t) => fromSource(t.releaseId) || crateSet.has(t.releaseId)) : data.tracks.filter((t) => crateSet.has(t.releaseId))).filter((t) => !set.trackIds.includes(t.id));
    const t = seq.length <= 1 ? 0 : Math.min(1, (index + 1) / Math.max(1, seq.length));
    return suggestNext(prev, pool.map(toSetTrack), { usedGroups: used, energyGoal: targetEnergy(set.curve as Curve, t), limit: 6 });
  };

  const insertTrack = (tid: string, at: number) => {
    const t = data?.byId.get(tid);
    const ids = [...set.trackIds];
    ids.splice(at, 0, tid);
    // Platte kommt automatisch mit in die Kiste
    update({ trackIds: ids, crateIds: t && !crateSet.has(t.releaseId) ? [...crate, t.releaseId] : crate });
    haptic(10);
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= set.trackIds.length) return;
    const ids = [...set.trackIds];
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    update({ trackIds: ids });
  };

  const save = async () => {
    const s = { ...set, name: set.name || `Set ${new Date().toLocaleDateString("de-DE")}` };
    const newId = await db.sets.put(s);
    // Neuer Gig mit Datum: gleich anbieten, ihn in den Kalender einzutragen
    if (s.date && !s.calendarAt && s.date >= new Date().toISOString().slice(0, 10)) setTimeout(() => setCalOpen(true), 350);
    void import("../lib/push").then((p) => p.syncPushData());
    toast("Set gespeichert");
    setDirty(false);
    if (isNew) nav(`/sets/${newId}`, { replace: true });
    setSet({ ...s, id: newId });
  };

  // Reinhören: ein Audio-Element für alles (iOS spielt nur nach Tippen)
  const togglePreview = (t: TrackMeta) => {
    const a = audio.current;
    if (!a) return;
    if (playing === t.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = t.deezerId ? `/api/audio/preview/${t.deezerId}` : previewUrl(t.artist, t.title, durOf(t));
    a.play().then(
      () => setPlaying(t.id),
      () => toast("Keine Hörprobe gefunden"),
    );
  };
  useEffect(() => {
    const a = audio.current;
    return () => a?.pause();
  }, []);

  const share = async () => {
    const text =
      `${set.name}${set.date ? ` · ${new Date(set.date).toLocaleDateString("de-DE")}` : ""}${set.venue ? ` · ${set.venue}` : ""}\n\n` +
      tracks.map((t, i) => `${String(i + 1).padStart(2, "0")}. ${t.artist} – ${t.title} [${t.position}]${t.bpm ? ` ${t.bpm} BPM` : ""}${t.key ? ` ${t.key}` : ""}`).join("\n");
    if (navigator.share) await navigator.share({ title: set.name, text }).catch(() => undefined);
    else await navigator.clipboard.writeText(text).then(() => toast("Setlist kopiert"));
  };

  // Link für Freunde: das ganze Set steckt im Link, für B2B mit Abgleich der Sammlungen
  const shareLink = async () => {
    const records: Record<number, { artist: string; title: string }> = {};
    for (const t of tracks) {
      const r = data?.rels.get(t.releaseId);
      if (r) records[t.releaseId] = { artist: r.artist, title: r.title };
    }
    const code = encodeSet({
      name: set.name || "Mein Set",
      date: set.date,
      venue: set.venue,
      curve: set.curve,
      by: djName || username() || undefined,
      tracks: tracks.map((t) => ({ releaseId: t.releaseId, position: t.position, title: t.title, artist: t.artist, bpm: t.bpm ?? undefined, key: t.key ?? undefined, note: set.mixNotes?.[t.id] })),
      crate: crate.map((rid) => ({ releaseId: rid, artist: data?.rels.get(rid)?.artist ?? "", title: data?.rels.get(rid)?.title ?? "" })),
      records,
    });
    const url = `${location.origin}/sets/shared#${code}`;
    const text = `Mein Set „${set.name || "Set"}“ auf Crate. Du siehst gleich, welche Platten du davon hast.`;
    if (navigator.share) await navigator.share({ title: set.name, text, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(url).then(() => toast("Link kopiert"));
  };

  return (
    <>
      <audio ref={audio} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)} />
      <CalendarSheet
        open={calOpen}
        onClose={() => setCalOpen(false)}
        event={gigEvent}
        onDone={() => {
          setCalOpen(false);
          const at = Date.now();
          setSet((x) => ({ ...x, calendarAt: at }));
          if (set.id) void db.sets.update(set.id, { calendarAt: at });
        }}
      />
      <NavBar
        title={set.name || (isNew ? "Neues Set" : "Set")}
        backTo="/sets"
        backLabel="Sets"
        right={
          <button className="text-btn" onClick={save} style={{ fontWeight: dirty ? 700 : 500 }}>
            Speichern
          </button>
        }
      />
      <div className="page stack">
        <input className="input" placeholder="Name, z. B. Freitag Klubraum" value={set.name} onChange={(e) => update({ name: e.target.value })} style={{ fontSize: 18, fontWeight: 600 }} />
        <div className="grid2">
          <input className="input" type="date" value={set.date ?? ""} onChange={(e) => update({ date: e.target.value })} />
          <input className="input" placeholder="Location" value={set.venue ?? ""} onChange={(e) => update({ venue: e.target.value })} />
        </div>
        {set.date && (
          <div className="gig-times">
            <label className="pe-field" style={{ padding: 0 }}>
              <span>Beginn</span>
              <input className="input" type="time" value={set.start ?? ""} onChange={(e) => update({ start: e.target.value || undefined })} />
            </label>
            <label className="pe-field" style={{ padding: 0 }}>
              <span>Ende</span>
              <input className="input" type="time" value={set.end ?? ""} onChange={(e) => update({ end: e.target.value || undefined })} />
            </label>
            <button className="btn tinted gig-cal" onClick={() => setCalOpen(true)}>
              {set.calendarAt ? "Kalender ✓" : "In den Kalender"}
            </button>
          </div>
        )}
        <div className="chips">
          {CURVES.map(([c, l, d]) => (
            <button key={c} className={`chip ${set.curve === c ? "on" : ""}`} onClick={() => update({ curve: c })} title={d}>
              {l}
            </button>
          ))}
        </div>
        {folders.length > 0 && (
          <div className="set-source">
            <span className="sub">Platten aus</span>
            <div className="chips chips-scroll">
              <button className={`chip ${!folderId ? "on" : ""}`} onClick={() => chooseFolder(undefined)}>
                Ganze Sammlung
              </button>
              {folders.map((f) => (
                <button key={f.id} className={`chip ${folderId === f.id ? "on" : ""}`} onClick={() => chooseFolder(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Überblick */}
        {tracks.length > 0 && (
          <div className="card set-summary">
            <div className="set-summary-nums">
              <span>
                <b>{tracks.length}</b> Tracks
              </span>
              <span>
                <b>~{minutes}</b> min
              </span>
              {stats.minBpm && (
                <span>
                  <b>
                    {Math.round(stats.minBpm)}
                    {Math.round(stats.maxBpm!) !== Math.round(stats.minBpm) ? `–${Math.round(stats.maxBpm!)}` : ""}
                  </b>{" "}
                  BPM
                </span>
              )}
              {stats.known > 0 && (
                <span>
                  <b>
                    {stats.harmonic}/{stats.known}
                  </b>{" "}
                  harmonisch
                </span>
              )}
            </div>
            <EnergyCurve curve={set.curve as Curve} actual={seq.map((t) => t.energy)} />
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn small primary" onClick={() => setLive(true)}>
                <IconPlay /> Live-Modus
              </button>
              <button className="btn small" onClick={() => setShareMenu(true)}>
                Teilen
              </button>
              <button className="btn small ghost" onClick={() => setAuto(true)}>
                Automatik
              </button>
            </div>
          </div>
        )}

        <Seg
          value={view}
          options={[
            ["order", `Reihenfolge (${tracks.length})`],
            ["crate", `Kiste (${crate.length})`],
          ]}
          onChange={setView}
        />

        {view === "order" ? (
          <>
            {tracks.length === 0 && (
              <div className="card stack" style={{ gap: 8 }}>
                <b>So baust du dein Set</b>
                <span className="sub">Pack zuerst die Platten für den Abend in die Kiste. Dann wählst du Track für Track, Crate schlägt jeweils vor, was gut danach passt, und sagt warum.</span>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn small primary" onClick={() => (setView("crate"), setPicker(true))}>
                    Kiste packen
                  </button>
                  {templates.length > 0 && (
                    <button className="btn small ghost" onClick={() => (setView("crate"), setTplOpen(true))}>
                      Vorlage laden
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => setAuto(true)}>
                    Automatisch vorschlagen
                  </button>
                </div>
              </div>
            )}
            <OrderList
              tracks={tracks}
              seq={seq}
              rels={data?.rels}
              estBpm={estBpm}
              notes={set.mixNotes ?? {}}
              playing={playing}
              onPreview={togglePreview}
              onMove={move}
              onRemove={(i) => update({ trackIds: set.trackIds.filter((_, j) => j !== i) })}
              onNote={setNoteFor}
              onInsert={(i) => setInsertAt(i)}
            />
            {/* Am Ende immer: was passt danach? */}
            <NextPanel
              title={tracks.length ? `Was passt nach „${tracks[tracks.length - 1].title}“?` : "Womit anfangen?"}
              items={suggestionsAt(tracks.length - 1)}
              data={data}
              wide={wide}
              hasCrate={crate.length > 0}
              onWide={setWide}
              onPick={(tid) => insertTrack(tid, set.trackIds.length)}
              onPreview={togglePreview}
              playing={playing}
              history={history}
              venue={set.venue}
            />
          </>
        ) : (
          <CrateView
            crate={crate}
            data={data}
            used={tracks.reduce((m, t) => m.set(t.releaseId, [...(m.get(t.releaseId) ?? []), t.position]), new Map<number, string[]>())}
            onAdd={() => setPicker(true)}
            onTemplates={() => setTplOpen(true)}
            onRemove={(rid) => update({ crateIds: crate.filter((x) => x !== rid), trackIds: set.trackIds.filter((tid) => data?.byId.get(tid)?.releaseId !== rid) })}
          />
        )}

        {!isNew && (
          <button
            className="btn ghost"
            style={{ color: "var(--bad)", marginTop: 16 }}
            onClick={async () => {
              if (!(await ask({ title: "Set löschen?", body: "Reihenfolge, Kiste und Mix-Notizen sind dann weg.", ok: "Löschen", danger: true }))) return;
              await db.sets.delete(Number(id));
              nav("/sets", { viewTransition: true });
            }}
          >
            Set löschen
          </button>
        )}
      </div>

      {/* Einfügen an einer Stelle */}
      <Sheet open={insertAt !== null} onClose={() => setInsertAt(null)}>
        {insertAt !== null && (
          <NextPanel
            title={insertAt === 0 ? "Was passt an den Anfang?" : insertAt >= tracks.length ? "Was passt ans Ende?" : `Zwischen #${insertAt} und #${insertAt + 1}`}
            items={suggestionsAt(insertAt - 1)}
            data={data}
            wide={wide}
            hasCrate={crate.length > 0}
            onWide={setWide}
            onPick={(tid) => {
              insertTrack(tid, insertAt);
              setInsertAt(null);
            }}
            onPreview={togglePreview}
            playing={playing}
            history={history}
            venue={set.venue}
            search
          />
        )}
      </Sheet>

      <Sheet open={picker} onClose={() => setPicker(false)}>
        <RecordPicker data={data} crate={crateSet} fromSource={fromSource} folderName={folderName} onToggle={(rid) => update({ crateIds: crateSet.has(rid) ? crate.filter((x) => x !== rid) : [...crate, rid] })} onDone={() => setPicker(false)} />
      </Sheet>

      <Sheet open={tplOpen} onClose={() => setTplOpen(false)}>
        {tplOpen && (
          <TemplateSheet
            crate={crate}
            suggestedName={set.name}
            onLoad={async (name, ids) => {
              const owned = await stillOwned(ids);
              const merged = [...new Set([...crate, ...owned])];
              const added = merged.length - crate.length;
              update({ crateIds: merged });
              setTplOpen(false);
              const gone = ids.length - owned.length;
              toast(`${added} ${added === 1 ? "Platte" : "Platten"} aus „${name}“ eingepackt${gone ? `, ${gone} nicht mehr in der Sammlung` : ""}`);
            }}
          />
        )}
      </Sheet>

      <Sheet open={noteFor !== null} onClose={() => setNoteFor(null)}>
        {noteFor && (
          <NoteEditor
            title={data?.byId.get(noteFor)?.title ?? ""}
            value={set.mixNotes?.[noteFor] ?? ""}
            onSave={(v) => {
              const n = { ...(set.mixNotes ?? {}) };
              if (v.trim()) n[noteFor] = v.trim();
              else delete n[noteFor];
              update({ mixNotes: n });
              setNoteFor(null);
            }}
          />
        )}
      </Sheet>

      <Sheet open={auto} onClose={() => setAuto(false)}>
        {auto && (
          <AutoHelp
            data={data}
            set={set}
            seq={seq}
            toSetTrack={toSetTrack}
            fromSource={fromSource}
            folderName={folderName}
            onApply={(ids, crateIds) => {
              update({ trackIds: ids, crateIds });
              setAuto(false);
              setView("order");
            }}
          />
        )}
      </Sheet>

      <MenuSheet
        open={shareMenu}
        onClose={() => setShareMenu(false)}
        title="Set teilen"
        items={[
          { label: "Als Story-Bild (Instagram)", onClick: () => (setShareMenu(false), setCard(true)) },
          { label: "Link für Freunde (B2B)", onClick: () => (setShareMenu(false), void shareLink()) },
          { label: "Als Text (Tracklist)", onClick: () => (setShareMenu(false), void share()) },
        ]}
      />
      <ShareCardSheet
        open={card}
        onClose={() => setCard(false)}
        title="Set als Story"
        filename={`crate-set-${(set.name || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}
        text={set.name}
        make={() =>
          renderSetCard({
            name: set.name || "Mein Set",
            date: set.date,
            venue: set.venue,
            dj: djName ?? undefined,
            tracks: tracks.map((t) => ({ title: t.title, artist: t.artist, bpm: t.bpm, key: t.key, cover: data?.rels.get(t.releaseId)?.cover || data?.rels.get(t.releaseId)?.thumb })),
            stats: [`${tracks.length} Tracks`, stats.minBpm ? `${Math.round(stats.minBpm)}–${Math.round(stats.maxBpm!)} BPM` : null, stats.known ? `${stats.harmonic}/${stats.known} harmonisch` : null].filter(Boolean).join("  ·  "),
          })
        }
      />

      {live && (
        <LiveMode
          tracks={tracks}
          rels={data?.rels}
          notes={set.mixNotes ?? {}}
          played={new Set(set.played ?? [])}
          onPlayed={(tid) => {
            const next = { ...set, played: [...new Set([...(set.played ?? []), tid])] };
            setSet(next);
            if (next.id) void db.sets.put(next);
          }}
          onClose={() => setLive(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reihenfolge mit Ziehen zum Umsortieren, Übergängen, Notizen und Einfügen
// ---------------------------------------------------------------------------
function OrderList(p: {
  tracks: TrackMeta[];
  seq: SetTrack[];
  rels?: Map<number, Release>;
  estBpm: Map<string, number>;
  notes: Record<string, string>;
  playing: string | null;
  onPreview: (t: TrackMeta) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (i: number) => void;
  onNote: (tid: string) => void;
  onInsert: (i: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; y0: number; dy: number } | null>(null);

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    list.current?.setPointerCapture(e.pointerId);
    haptic(8);
    setDrag({ from: i, over: i, y0: e.clientY, dy: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag || !list.current) return;
    const items = [...list.current.querySelectorAll<HTMLElement>("[data-item]")];
    // Ziel nach der Mitte der Zeilen bestimmen (Zeile unter dem Finger, ohne die gezogene selbst)
    let over = 0;
    items.forEach((el, i) => {
      if (i === drag.from) return;
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) over = i < drag.from ? i + 1 : i;
    });
    if (over !== drag.over) haptic(4);
    setDrag({ ...drag, over, dy: e.clientY - drag.y0 });
  };
  const endDrag = () => {
    if (drag) p.onMove(drag.from, drag.over);
    setDrag(null);
  };

  if (!p.tracks.length) return null;
  return (
    <>
    <Hint id="set-order">Zieh einen Track am Griff an eine neue Stelle. Tippe zwischen zwei Tracks für eine Mix-Notiz, mit + fügst du einen Track ein.</Hint>
    <div className={`order${drag ? " is-dragging" : ""}`} ref={list} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <button className="order-insert" onClick={() => p.onInsert(0)} aria-label="Am Anfang einfügen">
        <IconPlus />
      </button>
      {p.tracks.map((t, i) => {
        const prev = p.seq[i - 1];
        const cur = p.seq[i];
        const d = prev ? bpmDelta(prev.bpm, cur.bpm) : 0;
        const kd = prev ? keyDistance(parseKey(prev.key), parseKey(cur.key)) : 0;
        const dragging = drag?.from === i;
        const target = drag && !dragging && drag.over === i;
        return (
          <div key={t.id} data-item className={`order-item${dragging ? " dragging" : ""}${target ? (drag!.over > drag!.from ? " drop-after" : " drop-before") : ""}`} style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}>
            {prev && (
              <button className="transition press" onClick={() => p.onNote(t.id)}>
                <span className="dot" style={{ background: d <= 3 ? "var(--ok)" : d <= 6 ? "var(--warn)" : "var(--bad)" }} />
                {prev.bpm && cur.bpm ? (Math.round(cur.bpm) === Math.round(prev.bpm) ? "gleiches Tempo" : `${cur.bpm > prev.bpm ? "+" : ""}${Math.round(cur.bpm - prev.bpm)} BPM`) : "Tempo ?"}
                <span className="dot" style={{ background: kd <= 1 ? "var(--ok)" : kd <= 2 ? "var(--warn)" : "var(--bad)" }} />
                {kd <= 1 ? "harmonisch" : kd <= 2 ? "Energy-Boost" : prev.key && cur.key ? "Key-Clash" : "Key ?"}
                <span className="transition-note">{p.notes[t.id] ? `„${p.notes[t.id]}“` : "+ Notiz"}</span>
              </button>
            )}
            <div className="order-row">
              <span className="order-handle" onPointerDown={(e) => startDrag(i, e)} aria-label="Ziehen zum Umsortieren" role="button">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 9h14M5 15h14" />
                </svg>
              </span>
              <div className="order-track" onClick={() => p.onPreview(t)} role="button" aria-label={`${t.title} anhören`}>
                <TrackLine
                  t={t}
                  r={p.rels?.get(t.releaseId)}
                  extra={
                    <span className="sub">
                      #{i + 1}
                      {p.playing === t.id ? " · läuft" : ""}
                      {!t.bpm && p.estBpm.has(t.id) ? ` · ~${p.estBpm.get(t.id)} BPM geschätzt` : ""}
                    </span>
                  }
                />
              </div>
              <button className="icon-btn order-remove" onClick={() => p.onRemove(i)} aria-label="Aus dem Set nehmen">
                <IconX />
              </button>
            </div>
            {i < p.tracks.length - 1 && (
              <button className="order-insert" onClick={() => p.onInsert(i + 1)} aria-label={`Nach #${i + 1} einfügen`}>
                <IconPlus />
              </button>
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vorschläge mit Begründung
// ---------------------------------------------------------------------------
function NextPanel(p: {
  title: string;
  items: Suggestion[];
  data?: Data;
  wide: boolean;
  hasCrate: boolean;
  onWide: (v: boolean) => void;
  onPick: (tid: string) => void;
  onPreview: (t: TrackMeta) => void;
  playing: string | null;
  history?: Map<string, PlayedAt[]>;
  venue?: string;
  search?: boolean;
}) {
  const [q, setQ] = useState("");
  const found = useMemo(() => {
    if (!q.trim() || !p.data) return [];
    return p.data.tracks.filter((t) => matchesQuery(`${t.artist} ${t.title} ${p.data!.rels.get(t.releaseId)?.title ?? ""}`, q)).slice(0, 20);
  }, [q, p.data]);
  const rows: Suggestion[] = q.trim() ? found.map((t) => ({ id: t.id, reasons: [], score: 0 })) : p.items;
  return (
    <div className="next-panel">
      <div className="next-head">
        <b>{p.title}</b>
        {p.hasCrate && (
          <Seg
            value={p.wide ? "all" : "crate"}
            options={[
              ["crate", "Kiste"],
              ["all", "Alle"],
            ]}
            onChange={(v) => p.onWide(v === "all")}
          />
        )}
      </div>
      {p.search && <input className="input" placeholder="Oder gezielt suchen …" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />}
      {rows.map((s) => {
        const t = p.data?.byId.get(s.id);
        if (!t) return null;
        const r = p.data?.rels.get(t.releaseId);
        const stars = t.stars || p.data?.ratings.get(t.releaseId) || 0;
        return (
          <div key={s.id} className="next-item">
            <button className={`next-play${p.playing === t.id ? " on" : ""}`} onClick={() => p.onPreview(t)} aria-label={`${t.title} anhören`}>
              <Cover src={r?.thumb} />
              <span className="next-play-ico">
                <IconPlay />
              </span>
            </button>
            <div className="next-main" onClick={() => p.onPick(s.id)} role="button">
              <b>
                <span className="sub">{t.position}</span> {keepParens(t.title)}
              </b>
              <span className="sub next-sub">
                {t.artist}
                {r ? ` · ${r.title}` : ""}
              </span>
              <span className="next-reasons">
                {t.bpm ? <i className="info">{Math.round(t.bpm)} BPM</i> : null}
                {t.key ? <i className="info">{t.key}</i> : null}
                {s.reasons
                  .filter((x) => !x.text.includes("unbekannt"))
                  .map((x) => (
                    <i key={x.text} className={x.tone}>
                      {x.text}
                    </i>
                  ))}
                {stars ? <i className="info">★ {stars}</i> : null}
                {(() => {
                  // Schon gespielt? An derselben Location in den letzten 10 Wochen als Warnung
                  const h = p.history?.get(t.id)?.[0];
                  if (!h) return null;
                  const recentHere = p.venue && h.venue && h.venue.toLowerCase() === p.venue.toLowerCase() && Date.now() - new Date(h.date).getTime() < 70 * 86_400_000;
                  return <i className={recentHere ? "warn" : "info"}>gespielt {playedText(h)}</i>;
                })()}
              </span>
            </div>
            <button className="next-add" onClick={() => p.onPick(s.id)} aria-label="Ins Set">
              <IconPlus />
            </button>
          </div>
        );
      })}
      {!rows.length && <p className="sub" style={{ margin: "4px 0" }}>{q ? "Nichts gefunden." : p.hasCrate && !p.wide ? "Nichts mehr in der Kiste übrig. Auf „Alle“ schalten oder mehr Platten einpacken." : "Keine passenden Tracks gefunden."}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kiste: Platten für den Abend
// ---------------------------------------------------------------------------
function CrateView({ crate, data, used, onAdd, onTemplates, onRemove }: { crate: number[]; data?: Data; used: Map<number, string[]>; onAdd: () => void; onTemplates: () => void; onRemove: (rid: number) => void }) {
  const [sort, setSort] = useState<"added" | "shelf">("added");
  const list = useMemo(() => {
    const l = crate.map((rid) => ({ rid, r: data?.rels.get(rid), shelf: data?.metas.get(rid)?.shelf }));
    return sort === "shelf" ? [...l].sort((a, b) => (a.shelf ?? "~").localeCompare(b.shelf ?? "~", "de", { numeric: true })) : l;
  }, [crate, data, sort]);
  return (
    <div className="stack">
      <div className="row">
        <button className="btn small primary" onClick={onAdd}>
          <IconPlus /> Platten einpacken
        </button>
        <span className="spacer" />
        <button className="text-btn" style={{ whiteSpace: "nowrap" }} onClick={onTemplates}>
          Vorlagen
        </button>
      </div>
      {crate.length > 1 && (
        <Seg
          value={sort}
          options={[
            ["added", "Wie gepackt"],
            ["shelf", "Nach Regal"],
          ]}
          onChange={setSort}
        />
      )}
      {!crate.length && <p className="sub">Noch leer. Pack die Platten ein, die du mitnehmen willst. Aus ihnen kommen dann die Vorschläge.</p>}
      <div className="crate-grid">
        {list.map(({ rid, r, shelf }) => (
          <div key={rid} className="crate-tile">
            <div className="crate-cover">
              <Cover src={r?.cover || r?.thumb} />
              <button className="crate-x" onClick={() => onRemove(rid)} aria-label="Aus der Kiste nehmen">
                <IconX />
              </button>
              {used.get(rid) && <span className="crate-used">{used.get(rid)!.join(", ")}</span>}
            </div>
            <b>{r?.title ?? rid}</b>
            <span>{[r?.artist, shelf].filter(Boolean).join(" · ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordPicker({ data, crate, fromSource, folderName, onToggle, onDone }: { data?: Data; crate: Set<number>; fromSource: (rid: number) => boolean; folderName?: string; onToggle: (rid: number) => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [style, setStyle] = useState("");
  const styles = useMemo(() => {
    const c = new Map<string, number>();
    data?.rels.forEach((r) => fromSource(r.id) && r.styles.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([s]) => s);
  }, [data]);
  const bpmByRel = useMemo(() => {
    const m = new Map<number, number[]>();
    data?.tracks.forEach((t) => t.bpm && m.set(t.releaseId, [...(m.get(t.releaseId) ?? []), Math.round(t.bpm)]));
    return m;
  }, [data]);
  const list = useMemo(() => {
    const rels = [...(data?.rels.values() ?? [])];
    return rels
      .filter((r) => (fromSource(r.id) || crate.has(r.id)) && (!style || r.styles.includes(style)) && (!q.trim() || matchesQuery(`${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${(r.tracklist ?? []).map((t) => t.title).join(" ")}`, q)))
      .sort((a, b) => a.artist.localeCompare(b.artist, "de"))
      .slice(0, 80);
  }, [data, q, style]);
  const bpmText = (rid: number) => {
    const b = bpmByRel.get(rid) ?? [];
    return b.length ? (Math.min(...b) === Math.max(...b) ? `${b[0]} BPM` : `${Math.min(...b)}–${Math.max(...b)} BPM`) : "";
  };
  return (
    <div className="stack">
      <div className="row">
        <b style={{ fontSize: 18 }}>{folderName ? `Kiste packen aus „${folderName}“` : "Kiste packen"}</b>
        <span className="spacer" />
        <button className="text-btn" onClick={onDone}>
          Fertig ({crate.size})
        </button>
      </div>
      <input className="input" placeholder="Artist, Titel, Label, Track …" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips chips-scroll">
        <button className={`chip ${!style ? "on" : ""}`} onClick={() => setStyle("")}>
          Alle
        </button>
        {styles.map((s) => (
          <button key={s} className={`chip ${style === s ? "on" : ""}`} onClick={() => setStyle(style === s ? "" : s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="list">
        {list.map((r) => {
          const on = crate.has(r.id);
          return (
            <button key={r.id} className={`pick-rec press${on ? " on" : ""}`} onClick={() => (haptic(6), onToggle(r.id))} aria-pressed={on}>
              <Cover src={r.thumb} />
              <span className="pick-rec-main">
                <b>{r.title}</b>
                <span>{[r.artist, bpmText(r.id), r.styles[0]].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`pick-check${on ? " on" : ""}`}>{on ? "✓" : "+"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TemplateSheet({ crate, suggestedName, onLoad }: { crate: number[]; suggestedName: string; onLoad: (name: string, ids: number[]) => void }) {
  const templates = useTemplates();
  const [name, setName] = useState(suggestedName);
  const exists = templates.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <div className="stack">
      <b style={{ fontSize: 18 }}>Kisten-Vorlagen</b>
      {crate.length > 0 ? (
        <div className="card stack" style={{ gap: 8 }}>
          <span className="sub">Diese Kiste ({crate.length} Platten) merken, um sie für den nächsten Abend wieder zu laden.</span>
          <input className="input" placeholder="Name, z. B. Freitag Deep" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn small primary"
            disabled={!name.trim()}
            onClick={async () => {
              await saveTemplate(name, crate);
              haptic(10);
              toast(exists ? `„${name.trim()}“ aktualisiert` : `Vorlage „${name.trim()}“ gespeichert`);
            }}
          >
            {exists ? "Vorlage aktualisieren" : "Als Vorlage speichern"}
          </button>
        </div>
      ) : (
        <span className="sub">Pack eine Kiste, dann kannst du sie hier als Vorlage speichern.</span>
      )}
      {templates.length > 0 && (
        <div className="list">
          {templates.map((t) => (
            <div key={t.name} className="row tpl-row">
              <button className="tpl-main press" onClick={() => onLoad(t.name, t.ids)}>
                <b>{t.name}</b>
                <span className="sub">
                  {t.ids.length} Platten · {new Date(t.savedAt).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
                </span>
              </button>
              <button
                className="icon-btn"
                aria-label={`Vorlage ${t.name} löschen`}
                onClick={async () => {
                  if (await ask({ title: `Vorlage „${t.name}“ löschen?`, ok: "Löschen", danger: true })) void deleteTemplate(t.name);
                }}
              >
                <IconX />
              </button>
            </div>
          ))}
        </div>
      )}
      {templates.length > 0 && <span className="tiny sub">Antippen packt die Platten zusätzlich in die Kiste.</span>}
    </div>
  );
}

function NoteEditor({ title, value, onSave }: { title: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="stack">
      <b style={{ fontSize: 18 }}>Mix-Notiz</b>
      <span className="sub">Übergang zu „{title}“</span>
      <textarea className="input" rows={3} maxLength={200} placeholder="z. B. im Breakdown rein, Bass bei 1:20 raus, 16 Takte mischen" value={v} onChange={(e) => setV(e.target.value)} />
      <div className="chips">
        {["Bass tauschen", "im Breakdown rein", "kurzer Cut", "langer Blend", "Echo raus", "Pitch anpassen"].map((x) => (
          <button key={x} className="chip" onClick={() => setV(v ? `${v}, ${x}` : x)}>
            {x}
          </button>
        ))}
      </div>
      <button className="btn primary block" onClick={() => onSave(v)}>
        Notiz speichern
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Automatik als Hilfe: nur ordnen, oder aus der Kiste vorschlagen
// ---------------------------------------------------------------------------
function AutoHelp({ data, set, seq, toSetTrack, fromSource, folderName, onApply }: { data?: Data; set: DJSet; seq: SetTrack[]; toSetTrack: (t: TrackMeta) => SetTrack; fromSource: (rid: number) => boolean; folderName?: string; onApply: (ids: string[], crateIds: number[]) => void }) {
  const crate = set.crateIds ?? [];
  const [length, setLength] = useState(Math.max(10, seq.length || 20));
  const [perRecord, setPerRecord] = useState(1);
  const [keyWeight, setKeyWeight] = useState(1);
  const opts = { curve: set.curve as Curve, keyWeight };
  const order = () => {
    if (seq.length < 3) return toast("Erst ein paar Tracks auswählen, dann ordnet Crate sie.");
    onApply(buildSetlist(seq, { ...opts, length: seq.length, maxPerRecord: 3 }), crate);
    toast("Reihenfolge geordnet. Deine Auswahl bleibt gleich.");
  };
  const fill = async () => {
    if (!data) return;
    const pool = (crate.length ? data.tracks.filter((t) => crate.includes(t.releaseId)) : data.tracks.filter((t) => fromSource(t.releaseId))).map(toSetTrack);
    if (!pool.length) return toast("Keine Tracks gefunden");
    if (seq.length && !(await ask({ title: "Reihenfolge ersetzen?", body: "Der Vorschlag ersetzt deine aktuelle Reihenfolge.", ok: "Ersetzen" }))) return;
    const ids = buildSetlist(pool, { ...opts, length, maxPerRecord: perRecord });
    const rids = [...new Set(ids.map((i) => data.byId.get(i)?.releaseId).filter((x): x is number => x != null))];
    onApply(ids, [...new Set([...crate, ...rids])]);
  };
  return (
    <div className="stack">
      <b style={{ fontSize: 18 }}>Automatik</b>
      <div className="card stack" style={{ gap: 8, background: "var(--surface-2)" }}>
        <b>Nur ordnen</b>
        <span className="sub">Deine Tracks bleiben, Crate sortiert sie nach Energie-Kurve, Tempo und Tonart.</span>
        <button className="btn small primary" onClick={order} disabled={seq.length < 3}>
          {seq.length} Tracks ordnen
        </button>
      </div>
      <div className="card stack" style={{ gap: 8, background: "var(--surface-2)" }}>
        <b>{crate.length ? "Aus der Kiste vorschlagen" : folderName ? `Aus „${folderName}“ vorschlagen` : "Aus der Sammlung vorschlagen"}</b>
        <span className="sub">Ein Startpunkt zum Weiterbauen. {crate.length ? `Nimmt nur die ${crate.length} Platten aus deiner Kiste.` : "Tipp: Pack vorher eine Kiste, dann kommt nur raus, was du mitnimmst."}</span>
        <div className="grid2">
          <label className="field">
            Tracks
            <input className="input" inputMode="numeric" value={length} onChange={(e) => setLength(Number(e.target.value) || 0)} />
          </label>
          <label className="field">
            Harmonie
            <select className="input" value={keyWeight} onChange={(e) => setKeyWeight(Number(e.target.value))}>
              <option value={0}>egal</option>
              <option value={1}>wichtig</option>
              <option value={2}>sehr wichtig</option>
            </select>
          </label>
        </div>
        <div className="field">
          Tracks pro Platte
          <Seg
            value={String(perRecord) as "1" | "2" | "3"}
            options={[
              ["1", "Einer"],
              ["2", "Bis 2"],
              ["3", "Bis 3"],
            ]}
            onChange={(v) => setPerRecord(Number(v))}
          />
        </div>
        <button className="btn small" onClick={fill}>
          Vorschlag erstellen
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live-Modus beim Auflegen
// ---------------------------------------------------------------------------
function LiveMode({ tracks, rels, notes, played, onPlayed, onClose }: { tracks: TrackMeta[]; rels?: Map<number, Release>; notes: Record<string, string>; played: Set<string>; onPlayed: (tid: string) => void; onClose: () => void }) {
  const first = tracks.findIndex((t) => !played.has(t.id));
  const [i, setI] = useState(first < 0 ? 0 : first);
  const [menu, setMenu] = useState(false);
  const cur = tracks[i];
  const next = tracks[i + 1];
  useEffect(() => {
    // Bildschirm anlassen, solange der Live-Modus offen ist
    let lock: { release(): Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen").then(
      (l) => (lock = l),
      () => undefined,
    );
    return () => void lock?.release();
  }, []);
  if (!cur) return null;
  const r = rels?.get(cur.releaseId);
  const nr = next ? rels?.get(next.releaseId) : undefined;
  return (
    <div className="live" role="dialog" aria-label="Live-Modus">
      <div className="live-top">
        <button className="text-btn" onClick={onClose}>
          Fertig
        </button>
        <span className="sub">
          {i + 1} / {tracks.length}
        </span>
        <button className="text-btn" onClick={() => setMenu(true)}>
          Liste
        </button>
      </div>
      <div className="live-now">
        <Cover src={r?.cover || r?.thumb} className="cover live-cover" />
        <small>Läuft</small>
        <h2>{keepParens(cur.title)}</h2>
        <span className="sub">
          {cur.artist} · {r?.title} · {cur.position}
        </span>
        <div className="live-stats">
          {cur.bpm ? <b>{Math.round(cur.bpm)} BPM</b> : null}
          {cur.key ? <b>{cur.key}</b> : null}
        </div>
        {cur.cueOut && <p className="live-cue">Raus: {cur.cueOut}</p>}
      </div>
      <div className="live-next">
        {next ? (
          <>
            <small>Als Nächstes</small>
            <div className="row" style={{ gap: 12 }}>
              <Cover src={nr?.thumb} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <b className="live-next-title">{next.title}</b>
                <span className="sub">
                  {next.artist} · {next.position}
                  {next.bpm ? ` · ${Math.round(next.bpm)} BPM` : ""}
                  {next.key ? ` · ${next.key}` : ""}
                </span>
              </div>
            </div>
            {next.cueIn && <p className="live-cue">Rein: {next.cueIn}</p>}
            {notes[next.id] && <p className="live-note">„{notes[next.id]}“</p>}
          </>
        ) : (
          <small>Letzter Track</small>
        )}
      </div>
      <div className="live-actions">
        <button className="btn lg" disabled={i === 0} onClick={() => setI(i - 1)}>
          Zurück
        </button>
        <button
          className="btn primary lg"
          onClick={() => {
            haptic(15);
            onPlayed(cur.id);
            if (next) setI(i + 1);
            else onClose();
          }}
        >
          {next ? "Gespielt, weiter" : "Set beenden"}
        </button>
      </div>
      <MenuSheet open={menu} onClose={() => setMenu(false)} title="Springen zu" items={tracks.map((t, j) => ({ label: `${j + 1}. ${t.title} · ${t.artist}${played.has(t.id) ? " ✓" : ""}`, onClick: () => (setI(j), setMenu(false)) }))} />
    </div>
  );
}

function EnergyCurve({ curve, actual }: { curve: Curve; actual: (number | null)[] }) {
  const W = 300;
  const H = 56;
  const pts = Array.from({ length: 31 }, (_, i) => i / 30).map((t) => `${t * W},${H - (targetEnergy(curve, t) / 10) * H}`);
  const act = actual.map((e, i) => (e == null ? null : `${(i / Math.max(1, actual.length - 1)) * W},${H - (e / 10) * H}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 56 }} aria-label="Energie-Verlauf: gestrichelt die gewählte Kurve, farbig dein Set">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--text-3)" strokeDasharray="4 4" strokeWidth="2" />
      {act.length > 1 && <polyline points={act.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />}
    </svg>
  );
}
