// Platte des Tages auf dem Plattenteller: Antippen legt den Tonarm auf und spielt die Hörprobe
// über den App-Player (läuft beim Seitenwechsel weiter).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release, type TrackMeta } from "../lib/db";
import { play, stop, toggle, usePlayer } from "../lib/player";
import { toast } from "../lib/store";
import { previewUrl } from "../lib/free";
import { haptic, keepParens } from "./bits";
import { IconPause, IconPlay } from "./icons";
import { ToneArm } from "./ToneArm";
import { dailyPick } from "../../../shared/daily";

export function DailyRecord() {
  const today = new Date().toISOString().slice(0, 10);
  // Einmal beim Öffnen bestimmen (nicht bei jeder Änderung während eines Syncs neu rechnen)
  const count = useLiveQuery(() => db.collection.count(), []);
  const [pick, setPick] = useState<{ id: number; reason: string; rel: Release; tracks: TrackMeta[] } | null>(null);
  useEffect(() => {
    if (!count) return;
    let alive = true;
    void (async () => {
      const coll = await db.collection.toArray();
      // Was in den letzten 60 Tagen in einem Set lief, ruht erstmal
      const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      const sets = (await db.sets.toArray()).filter((s) => s.date && s.date >= since && s.date <= today);
      const tids = sets.flatMap((s) => (s.played?.length ? s.played : s.trackIds));
      const played = new Set(((await db.tracks.bulkGet(tids)).filter(Boolean) as { releaseId: number }[]).map((t) => t.releaseId));
      // Platten mit bekannter Hörprobe (Deezer-Treffer aus dem Abgleich)
      const playable = new Set<number>();
      await db.tracks.each((t) => {
        if (t.deezerId) playable.add(t.releaseId);
      });
      const p = dailyPick(coll.map((c) => ({ id: c.releaseId, dateAdded: c.dateAdded })), today, played, playable);
      const rel = p && (await db.releases.get(p.id));
      if (!p || !rel || !alive) return;
      const tracks = (await db.tracks.where("releaseId").equals(p.id).toArray()).sort((a, b) => a.position.localeCompare(b.position, "de", { numeric: true }));
      setPick({ ...p, rel, tracks });
    })();
    return () => {
      alive = false;
    };
  }, [count, today]);
  const player = usePlayer();
  const [busy, setBusy] = useState(false);
  if (!pick) return null;
  const { rel, tracks, reason } = pick;
  const mine = player.now?.releaseId === rel.id;
  const spinning = mine && player.playing;
  const start = async () => {
    haptic(10);
    if (mine && !player.failed) return toggle();
    // Erst Tracks mit sicherer Hörprobe, dann die übrigen nach Titel suchen; höchstens vier Versuche
    const order = [...tracks.filter((t) => t.deezerId), ...tracks.filter((t) => !t.deezerId)].slice(0, 4);
    const cands = order.length ? order.map((t) => ({ title: t.title, artist: t.artist || rel.artist, deezerId: t.deezerId, id: t.id as string | undefined })) : (rel.tracklist ?? []).slice(0, 3).map((t) => ({ title: t.title, artist: rel.artist, deezerId: undefined, id: undefined }));
    setBusy(true);
    let ok = false;
    for (const c of cands) {
      ok = await play({ src: c.deezerId ? `/api/audio/preview/${c.deezerId}` : previewUrl(c.artist, c.title), title: c.title, artist: c.artist, cover: rel.cover || rel.thumb, releaseId: rel.id, trackId: c.id });
      if (ok) break;
    }
    setBusy(false);
    if (!ok) {
      stop();
      toast("Zu dieser Platte gibt es keine Hörprobe. Auf der Platten-Seite findest du Videos.");
    }
  };
  return (
    <section className={`daily${spinning ? " on" : ""}`} aria-label="Platte des Tages">
      <button className="daily-deck" onClick={() => void start()} aria-label={spinning ? "Pause" : `${rel.title} anhören`}>
        <span className="daily-disc">
          {(rel.cover || rel.thumb) && <img src={rel.cover || rel.thumb} alt="" />}
        </span>
        <ToneArm down={spinning} />
      </button>
      <div className="daily-text">
        <span className="eyebrow">{reason}</span>
        <Link to={`/release/${rel.id}`} viewTransition className="daily-title">
          <b>{keepParens(rel.title)}</b>
          <span>{[rel.artist, rel.year || null].filter(Boolean).join(" · ")}</span>
        </Link>
        <button className="daily-play press" onClick={() => void start()} disabled={busy}>
          {spinning ? <IconPause /> : <IconPlay />}
          {busy ? "Lädt …" : spinning ? "Pause" : mine && !player.failed ? "Weiter" : "Auflegen"}
        </button>
      </div>
    </section>
  );
}
