import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "../lib/api";
import { db, realTracks, trackId, type TrackMeta } from "../lib/db";
import { addToCollection, addWant, fetchMarketStats, fetchRelease, lookupAudioFor, removeWant, tagVibes } from "../lib/sync";
import { discogsReleaseUrl, discogsSellUrl, formatLine, money } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { Cover, Energy, KeyBadge, Sheet, TapTempo } from "../components/bits";
import { IconBack, IconPlay } from "../components/icons";

export default function ReleasePage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const me = useStore((s) => s.me);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<TrackMeta | null>(null);

  const rel = useLiveQuery(() => db.releases.get(id), [id]);
  const tracks = useLiveQuery(() => db.tracks.where("releaseId").equals(id).toArray(), [id], []);
  const inColl = useLiveQuery(() => db.collection.where("releaseId").equals(id).count(), [id], 0);
  const isWant = useLiveQuery(async () => Boolean(await db.wants.get(id)), [id], false);
  const meta = useLiveQuery(() => db.recordMeta.get(id), [id]);
  const stat = useLiveQuery(() => db.marketStats.get(id), [id]);

  useEffect(() => {
    db.releases.get(id).then((r) => {
      if (r?.detailFetchedAt) return;
      setLoading(true);
      fetchRelease(id)
        .catch((e) => toast(e.message))
        .finally(() => setLoading(false));
    });
    fetchMarketStats([id]).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!rel) return <div className="empty">{loading ? "Lade …" : "Nicht gefunden"}</div>;
  const tm = new Map(tracks.map((t) => [t.id, t]));
  const tl = realTracks(rel.tracklist);

  const setMeta = (patch: Record<string, unknown>) => db.recordMeta.put({ ...meta, releaseId: id, ...patch });
  const saveTrack = (t: TrackMeta, patch: Partial<TrackMeta>) => db.tracks.update(t.id, patch);

  return (
    <>
      <div className="page-head">
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Zurück">
          <IconBack />
        </button>
        <span className="spacer" />
        <a className="btn small ghost" href={discogsReleaseUrl(id)} target="_blank" rel="noreferrer">
          Discogs ↗
        </a>
      </div>
      <div className="page">
        <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: "40%", flex: "none" }}>
            <Cover src={rel.cover || rel.thumb} className="cover lg" />
          </div>
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <div className="sub">{rel.artist}</div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{rel.title}</div>
            <div className="sub">
              {rel.labels.map((l) => `${l.name.replace(/\s\(\d+\)$/, "")} – ${l.catno}`).join(", ")}
            </div>
            <div className="sub">
              {[rel.country, rel.year || null, formatLine(rel)].filter(Boolean).join(" · ")}
            </div>
            <div className="chips" style={{ flexWrap: "wrap" }}>
              {rel.styles.map((s) => (
                <span key={s} className="badge">
                  {s}
                </span>
              ))}
            </div>
            {inColl > 0 && <span className="badge ok">In deiner Sammlung</span>}
          </div>
        </div>

        <div className="row wrap" style={{ marginTop: 14 }}>
          {inColl === 0 && (
            <button className="btn primary small" onClick={() => addToCollection(id).then(() => toast("Zur Sammlung hinzugefügt, Sticker vorgemerkt"), (e) => toast(e.message))}>
              + Sammlung
            </button>
          )}
          <button
            className={`btn small ${isWant ? "" : "ghost"}`}
            onClick={() => (isWant ? removeWant(id).then(() => toast("Aus Wantlist entfernt")) : addWant(id).then(() => toast("Auf die Wantlist gesetzt"))).catch((e) => toast(e.message))}
          >
            {isWant ? "♥ In Wantlist" : "♡ Wantlist"}
          </button>
          <a className="btn small ghost" href={discogsSellUrl(id)} target="_blank" rel="noreferrer">
            Marktplatz ↗
          </a>
          {inColl > 0 && (
            <button className="btn small ghost" onClick={() => nav(`/stickers?ids=${id}`)}>
              Sticker
            </button>
          )}
        </div>

        {stat && (
          <div className="card row" style={{ marginTop: 14 }}>
            <div>
              <div className="sub">Günstigstes Angebot</div>
              <b>{stat.numForSale ? money(stat.lowest, stat.currency) : "keins"}</b>
            </div>
            <span className="spacer" />
            <div style={{ textAlign: "right" }}>
              <div className="sub">Angebote</div>
              <b>{stat.numForSale}</b>
            </div>
            {rel.community && (
              <div style={{ textAlign: "right", marginLeft: 14 }}>
                <div className="sub">Have / Want</div>
                <b>
                  {rel.community.have} / {rel.community.want}
                </b>
              </div>
            )}
          </div>
        )}

        {inColl > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            <input
              className="input"
              placeholder="Regalplatz, z.B. Kallax 2 · Fach C"
              defaultValue={meta?.shelf ?? ""}
              onBlur={(e) => setMeta({ shelf: e.target.value })}
              key={meta?.shelf}
            />
            <input
              className="input"
              placeholder="Crates, z.B. Freitag, Disco"
              defaultValue={(meta?.crates ?? []).join(", ")}
              onBlur={(e) => setMeta({ crates: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              key={(meta?.crates ?? []).join()}
            />
          </div>
        )}

        <div className="row" style={{ marginTop: 18 }}>
          <h2 style={{ margin: 0 }}>Tracks</h2>
          <span className="spacer" />
          <button className="btn small ghost" onClick={() => lookupAudioFor(tracks.map((t) => t.id)).then((n) => toast(n ? `${n} Track(s) ergänzt` : "Keine neuen Daten gefunden"), (e) => toast(e.message))}>
            BPM/Key suchen
          </button>
          {me?.features.ai && (
            <button className="btn small ghost" onClick={() => tagVibes(tracks.map((t) => t.id)).then(() => toast("Vibes getaggt"), (e) => toast(e.message))}>
              Vibes
            </button>
          )}
        </div>
        <table className="tracks">
          <tbody>
            {tl.map((t, i) => {
              const m = tm.get(trackId(id, t.position, i));
              return (
                <tr key={t.position + i} onClick={() => m && setEdit(m)} style={{ cursor: "pointer" }}>
                  <td className="pos">{t.position}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div className="sub">
                      {m?.artist !== rel.artist ? m?.artist : ""} {t.duration}
                      {m?.moods?.length ? ` · ${m.moods.join(", ")}` : ""}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {m?.bpm ? <b>{m.bpm}</b> : <span className="sub">–</span>} <KeyBadge k={m?.key} />
                    <div>
                      <Energy v={m?.energy} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!tl.length && <div className="sub">{loading ? "Lade Tracklist …" : "Keine Tracklist bei Discogs."}</div>}

        {rel.videos?.length ? (
          <>
            <h2>Reinhören</h2>
            <div className="stack">
              {rel.videos.slice(0, 6).map((v) => {
                const yt = v.uri.match(/[?&]v=([\w-]{11})/)?.[1];
                return yt ? <iframe key={v.uri} className="video" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={v.title} allowFullScreen loading="lazy" /> : null;
              })}
            </div>
          </>
        ) : null}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)}>
        {edit && <TrackEdit t={edit} onSave={(p) => saveTrack(edit, p).then(() => setEdit(null))} />}
      </Sheet>
    </>
  );
}

function TrackEdit({ t, onSave }: { t: TrackMeta; onSave: (p: Partial<TrackMeta>) => void }) {
  const [bpm, setBpm] = useState(String(t.bpm ?? ""));
  const [key, setKey] = useState(t.key ?? "");
  const [energy, setEnergy] = useState(t.energy ?? 5);
  const [moods, setMoods] = useState((t.moods ?? []).join(", "));
  const [stars, setStars] = useState(t.stars ?? 0);
  const [notes, setNotes] = useState(t.notes ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="stack">
      <div>
        <div className="sub">
          {t.position} · {t.artist}
        </div>
        <b style={{ fontSize: 18 }}>{t.title}</b>
      </div>
      {preview ? (
        <audio controls autoPlay src={preview} style={{ width: "100%" }} />
      ) : (
        <button
          className="btn small ghost"
          onClick={() =>
            api<{ previewUrl: string | null }>(`/api/audio/lookup?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}`).then(
              (r) => (r.previewUrl ? setPreview(r.previewUrl) : toast("Keine Hörprobe gefunden")),
              (e) => toast(e.message),
            )
          }
        >
          <IconPlay /> 30-Sekunden-Hörprobe (Deezer)
        </button>
      )}
      <div className="grid2">
        <label className="field">
          BPM
          <input className="input" inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value)} />
        </label>
        <label className="field">
          Key (Am, F#, 8A …)
          <input className="input" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
      </div>
      <TapTempo onBpm={(b) => setBpm(String(b))} />
      <label className="field">
        Energie: {energy}/10
        <input type="range" min={1} max={10} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} />
      </label>
      <label className="field">
        Vibes (kommagetrennt)
        <input className="input" value={moods} onChange={(e) => setMoods(e.target.value)} placeholder="deep, housy, warmup" />
      </label>
      <div className="row">
        <span className="sub">Bewertung</span>
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} className="icon-btn" style={{ color: s <= stars ? "var(--accent)" : undefined, fontSize: 22 }} onClick={() => setStars(s === stars ? 0 : s)}>
            ★
          </button>
        ))}
      </div>
      <label className="field">
        Notiz (z.B. „guter Opener“, „passt zu …“)
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button
        className="btn primary block"
        onClick={() =>
          onSave({
            bpm: Number(bpm.replace(",", ".")) ? Math.round(Number(bpm.replace(",", ".")) * 10) / 10 : null,
            key: key.trim() || null,
            energy,
            moods: moods.split(",").map((s) => s.trim()).filter(Boolean),
            stars,
            notes,
            bpmSource: bpm !== String(t.bpm ?? "") ? "manuell" : t.bpmSource,
          })
        }
      >
        Speichern
      </button>
    </div>
  );
}
