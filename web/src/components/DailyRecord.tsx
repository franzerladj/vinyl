// Platte des Tages auf dem Plattenteller: Antippen legt den Tonarm auf und spielt die Hörprobe
// über den App-Player (läuft beim Seitenwechsel weiter).
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { play, toggle, usePlayer } from "../lib/player";
import { previewUrl } from "../lib/free";
import { haptic, keepParens } from "./bits";
import { IconPause, IconPlay } from "./icons";
import { ToneArm } from "./ToneArm";
import { dailyPick } from "../../../shared/daily";

export function DailyRecord() {
  const today = new Date().toISOString().slice(0, 10);
  const pick = useLiveQuery(async () => {
    const coll = await db.collection.toArray();
    // Was in den letzten 60 Tagen in einem Set lief, ruht erstmal
    const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const sets = (await db.sets.toArray()).filter((s) => s.date && s.date >= since && s.date <= today);
    const tids = sets.flatMap((s) => s.played?.length ? s.played : s.trackIds);
    const played = new Set(((await db.tracks.bulkGet(tids)).filter(Boolean) as { releaseId: number }[]).map((t) => t.releaseId));
    const p = dailyPick(coll.map((c) => ({ id: c.releaseId, dateAdded: c.dateAdded })), today, played);
    if (!p) return null;
    const rel = await db.releases.get(p.id);
    if (!rel) return null;
    const tracks = (await db.tracks.where("releaseId").equals(p.id).toArray()).sort((a, b) => a.position.localeCompare(b.position, "de", { numeric: true }));
    const t = tracks.find((x) => x.deezerId) ?? tracks[0];
    return { ...p, rel, track: t };
  }, [today]);
  const player = usePlayer();
  if (!pick) return null;
  const { rel, track, reason } = pick;
  const mine = player.now?.releaseId === rel.id;
  const spinning = mine && player.playing;
  const start = () => {
    haptic(10);
    if (mine) return toggle();
    const title = track?.title ?? rel.tracklist?.[0]?.title ?? rel.title;
    const artist = track?.artist ?? rel.artist;
    void play({ src: track?.deezerId ? `/api/audio/preview/${track.deezerId}` : previewUrl(artist, title), title, artist, cover: rel.cover || rel.thumb, releaseId: rel.id, trackId: track?.id });
  };
  return (
    <section className={`daily${spinning ? " on" : ""}`} aria-label="Platte des Tages">
      <button className="daily-deck" onClick={start} aria-label={spinning ? "Pause" : `${rel.title} anhören`}>
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
        <button className="daily-play press" onClick={start}>
          {spinning ? <IconPause /> : <IconPlay />}
          {spinning ? "Pause" : mine ? "Weiter" : "Auflegen"}
        </button>
      </div>
    </section>
  );
}
