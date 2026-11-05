import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "../lib/api";
import { db, realTracks, trackId, type TrackMeta } from "../lib/db";
import { addToCollection, addWant, fetchMarketStats, fetchRelease, lookupAudioFor, removeWant, setCondition, tagVibes } from "../lib/sync";
import { GRADE_HINT, MEDIA_GRADES, SLEEVE_GRADES, pressingInfo, shortGrade } from "../../../shared/vinyl";
import type { CollectionItem } from "../lib/db";
import { discogsReleaseUrl, discogsSellUrl, formatLine, money, sideOf } from "../lib/format";
import { toast, useStore } from "../lib/store";
import { Avatar, Cover, DealDot, Empty, Energy, haptic, KeyBadge, Sheet, SkeletonRows, Sparkline, TapTempo, type Preview } from "../components/bits";
import { loadPriceInfo, setTargetPrice } from "../lib/prices";
import { friendsFor, lendRecord, messageUrl } from "../lib/friends";
import { MenuSheet } from "../components/ui";
import { previewUrl } from "../lib/free";
import { ytConsent } from "../lib/theme";
import { playedHistory, playedText } from "../lib/setHistory";
import { matchVideo, parseDuration, youtubeId } from "../../../shared/match";
import { IconBack, IconCart, IconExternal, IconShare, IconHeart, IconPlay, IconPlus, IconPrint, IconWave } from "../components/icons";

export default function ReleasePage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const loc = useLocation();
  const preview = (loc.state as { preview?: Preview } | null)?.preview;
  const me = useStore((s) => s.me);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<TrackMeta | null>(null);
  const [playing, setPlaying] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const [lendSheet, setLendSheet] = useState(false);
  const [grading, setGrading] = useState<{ item: CollectionItem; which: "media" | "sleeve" } | null>(null);
  const copies = useLiveQuery(() => db.collection.where("releaseId").equals(id).toArray(), [id], [] as CollectionItem[]);
  const buddies = useLiveQuery(() => friendsFor(id), [id]);
  const friendNames = useLiveQuery(async () => (await db.friends.toArray()).map((f) => f.username), [], [] as string[]);
  const audioRef = useRef<HTMLAudioElement>(null);

  const rel = useLiveQuery(() => db.releases.get(id), [id]);
  const tracks = useLiveQuery(() => db.tracks.where("releaseId").equals(id).toArray(), [id], []);
  const inColl = useLiveQuery(() => db.collection.where("releaseId").equals(id).count(), [id], 0);
  const isWant = useLiveQuery(async () => Boolean(await db.wants.get(id)), [id], false);
  const meta = useLiveQuery(() => db.recordMeta.get(id), [id]);
  const stat = useLiveQuery(() => db.marketStats.get(id), [id]);
  const price = useLiveQuery(async () => (await loadPriceInfo([id])).get(id), [id]);
  const offers = useLiveQuery(async () => (await db.listings.where("releaseId").equals(id).toArray()).sort((a, b) => a.price - b.price), [id], []);

  useEffect(() => {
    db.releases.get(id).then((r) => {
      // Ältere Einträge ohne Pressungsdaten still nachladen
      if (r?.detailFetchedAt && r.identifiers === undefined) return void fetchRelease(id, true).catch(() => undefined);
      if (r?.detailFetchedAt) return;
      setLoading(true);
      fetchRelease(id)
        .catch((e) => toast(e.message))
        .finally(() => setLoading(false));
    });
    fetchMarketStats([id]).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const coverSrc = rel?.cover || rel?.thumb || preview?.cover || preview?.thumb;
  const back = () => ((window.history.state as { idx?: number } | null)?.idx ? nav(-1) : nav("/", { replace: true }));

  const top = (
    <div className="stage">
      {coverSrc && <div className="stage-bg" style={{ backgroundImage: `url("${coverSrc}")` }} />}
      <div className="stage-top">
        <button className="icon-btn" data-back onClick={back} aria-label="Zurück">
          <IconBack />
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="icon-btn"
            aria-label="Teilen"
            onClick={() => {
              const url = discogsReleaseUrl(id);
              const text = `${rel?.artist ?? preview?.artist ?? ""} – ${rel?.title ?? preview?.title ?? ""}`;
              if (navigator.share) navigator.share({ title: text, text, url }).catch(() => undefined);
              else navigator.clipboard.writeText(`${text} ${url}`).then(() => toast("Link kopiert"));
            }}
          >
            <IconShare />
          </button>
          <a className="icon-btn" href={discogsReleaseUrl(id)} target="_blank" rel="noreferrer" aria-label="Auf Discogs öffnen">
            <IconExternal />
          </a>
        </div>
      </div>
      <div className="deck">
        <div className={`vinyl ${playing ? "spin" : ""}`} aria-hidden="true">
          {coverSrc && <div className="label" style={{ backgroundImage: `url("${coverSrc}")` }} />}
        </div>
        <Cover src={coverSrc} className="cover lg" style={{ viewTransitionName: "hero-cover" }} />
      </div>
      <h1>{rel?.title ?? preview?.title ?? ""}</h1>
      <div className="artist">{rel?.artist ?? preview?.artist ?? ""}</div>
      {rel && (
        <div className="meta">
          {[rel.labels[0] && `${rel.labels[0].name.replace(/\s\(\d+\)$/, "")} · ${rel.labels[0].catno}`, rel.country, rel.year || null].filter(Boolean).join(" · ")}
        </div>
      )}
      {rel && <div className="tiny" style={{ marginTop: 4 }}>{formatLine(rel)}</div>}
    </div>
  );

  if (!rel) return <>{top}<div className="page">{loading || preview ? <SkeletonRows n={4} /> : <Empty title="Nicht gefunden" />}</div></>;
  const tm = new Map(tracks.map((t) => [t.id, t]));
  const tl = realTracks(rel.tracklist);
  let lastSide = "";

  const setMeta = (patch: Record<string, unknown>) => db.recordMeta.put({ ...meta, releaseId: id, ...patch });
  const saveTrack = (t: TrackMeta, patch: Partial<TrackMeta>) => db.tracks.update(t.id, patch);
  /** Track antippen: passendes YouTube-Video starten, sonst die Deezer-Hörprobe (direkt in der Tipp-Geste, damit Browser das Abspielen erlauben) */
  const openTrack = (m: TrackMeta, t: { title: string; duration?: string }) => {
    haptic(5);
    const audio = audioRef.current;
    const dur = parseDuration(t.duration);
    const video = matchVideo({ title: t.title, artist: m.artist, duration: dur }, rel.videos, tl.length);
    if (video) {
      audio?.pause();
      setMedia({ type: "yt", id: youtubeId(video.uri)!, title: video.title });
      setPlaying(true);
    } else if (audio) {
      audio.src = m.deezerId ? `/api/audio/preview/${m.deezerId}` : previewUrl(m.artist, m.title, dur);
      audio.play().catch(() => undefined);
      setMedia({ type: "deezer" });
    }
    setEdit(m);
  };
  const closeTrack = () => {
    audioRef.current?.pause();
    setMedia(null);
    setPlaying(false);
    setEdit(null);
  };

  const toggleWant = () => {
    haptic();
    (isWant ? removeWant(id).then(() => toast("Aus der Wantlist entfernt")) : addWant(id).then(() => toast("Auf der Wantlist"))).catch((e) => toast(e.message));
  };

  return (
    <>
      {top}
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="actions">
          {inColl === 0 ? (
            <button className="action on" onClick={() => (haptic(), addToCollection(id).then(() => toast("In der Sammlung · Sticker vorgemerkt"), (e) => toast(e.message)))}>
              <IconPlus />
              Sammlung
            </button>
          ) : (
            <button className="action" onClick={() => nav(`/stickers?ids=${id}`, { viewTransition: true })}>
              <IconPrint />
              Drucken
            </button>
          )}
          <button className={`action ${isWant ? "on" : ""}`} onClick={toggleWant} aria-pressed={isWant}>
            <IconHeart />
            {isWant ? "Gewünscht" : "Wantlist"}
          </button>
          <a className="action" href={discogsSellUrl(id)} target="_blank" rel="noreferrer">
            <IconCart />
            Marktplatz
          </a>
        </div>

        <div className="grid3" style={{ marginTop: 10 }}>
          <div className="stat">
            <span>ab</span>
            <b className="stat-sm">{stat ? (stat.numForSale ? money(stat.lowest, stat.currency) : "–") : "…"}</b>
          </div>
          <div className="stat">
            <span>Angebote</span>
            <b className="stat-sm">{stat?.numForSale ?? "…"}</b>
          </div>
          <div className="stat">
            <span>Wollen</span>
            <b className="stat-sm">{rel.community ? rel.community.want : "–"}</b>
            {rel.community && <span className="tiny">{rel.community.have} haben</span>}
          </div>
        </div>

        {isWant && price && (
          <div className="card stack" style={{ marginTop: 10, gap: 10 }}>
            <div className="row">
              <DealDot a={price.deal.ampel} />
              <b>
                {price.deal.ampel === "green" ? "Gutes Angebot" : price.deal.ampel === "yellow" ? "Fairer Preis" : price.deal.ampel === "red" ? "Gerade teuer" : "Noch zu wenig Preisdaten"}
              </b>
              <span className="spacer" />
              <Sparkline values={price.history.map((h) => h.lowest ?? 0)} width={90} height={26} />
            </div>
            {price.deal.reasons.length > 0 && <div className="sub">{price.deal.reasons.join(" · ")}</div>}
            {price.suggestion && (
              <div className="chips">
                {["M", "NM", "VG+", "VG", "G+"].filter((g) => price.suggestion!.values[g]).map((g) => (
                  <span key={g} className="chip" style={{ cursor: "default" }}>
                    {g} <span className="sub">{money(price.suggestion!.values[g], price.suggestion!.currency)}</span>
                  </span>
                ))}
              </div>
            )}
            {price.suggestion && <div className="tiny">Preisempfehlung von Discogs aus echten Verkäufen</div>}
            <label className="row">
              <span className="sub" style={{ flex: "none" }}>Mein Wunschpreis</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="z.B. 15"
                defaultValue={price.target ?? ""}
                key={String(price.target)}
                onBlur={(e) => {
                  const v = Number(e.target.value.replace(",", "."));
                  void setTargetPrice(id, v > 0 ? v : null).then(() => v > 0 && toast(`Wunschpreis ${money(v)} gesetzt`));
                }}
                style={{ maxWidth: 120, marginLeft: "auto" }}
              />
            </label>
          </div>
        )}

        {offers.length > 0 && !inColl && (
          <>
            <h2>Bei deinen Händlern</h2>
            <div className="group">
              {offers.slice(0, 5).map((o) => (
                <a key={o.listingId} className="set-row press" href={`https://www.discogs.com/sell/item/${o.listingId}`} target="_blank" rel="noreferrer">
                  <span className="label">
                    {o.seller}
                    <small>
                      {o.condition}
                      {o.sleeveCondition ? ` · Hülle ${o.sleeveCondition}` : ""}
                      {o.shipsFrom ? ` · aus ${o.shipsFrom}` : ""}
                    </small>
                  </span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(o.price)}</b>
                  <span className="chev" style={{ color: "var(--text-3)" }}>↗</span>
                </a>
              ))}
            </div>
          </>
        )}

        {rel.styles.length > 0 && (
          <div className="chips" style={{ marginTop: 14 }}>
            {[...rel.genres, ...rel.styles].map((s) => (
              <Link key={s} to={`/search?style=${encodeURIComponent(s)}`} className="chip">
                {s}
              </Link>
            ))}
          </div>
        )}

        {buddies && buddies.length > 0 && (
          <>
            <h2>Bei deinen Freunden</h2>
            <div className="group">
              {buddies.map(({ friend, kind }) => (
                <Link key={friend.username + kind} to={`/friends/${encodeURIComponent(friend.username)}`} viewTransition className="group-row">
                  <Avatar src={friend.avatar} name={friend.username} size={34} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>{friend.name || friend.username}</b>
                    <span className="sub" style={{ display: "block", fontSize: 13 }}>{kind === "coll" ? "hat diese Platte" : "sucht diese Platte auch"}</span>
                  </span>
                  {kind === "coll" && isWant && (
                    <a className="btn small tinted" href={messageUrl(friend.username)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      Fragen
                    </a>
                  )}
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 22 }}>
          <h2 style={{ margin: 0 }}>Tracks</h2>
          <span className="spacer" />
          <button
            className="btn small tinted"
            onClick={async () => {
              haptic();
              try {
                const ids = tracks.map((t) => t.id);
                await lookupAudioFor(ids);
                await tagVibes(ids, { audio: true });
                toast("BPM, Key und Stimmung ergänzt");
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <IconWave /> BPM & Key messen
          </button>
        </div>
        <table className="tracks">
          <tbody>
            {tl.flatMap((t, i) => {
              const m = tm.get(trackId(id, t.position, i));
              const side = sideOf(t.position);
              const rows = [];
              if (side && side !== lastSide) {
                rows.push(
                  <tr key={`side-${side}`} className="side-head">
                    <td colSpan={3}>SEITE {side}</td>
                  </tr>,
                );
              }
              lastSide = side;
              rows.push(
                <tr key={t.position + i} onClick={() => m && openTrack(m, t)} style={{ cursor: "pointer", background: edit?.id === m?.id ? "var(--accent-soft)" : undefined }}>
                  <td className="pos" style={{ color: edit?.id === m?.id ? "var(--accent)" : undefined }}>{edit?.id === m?.id && playing ? "♪" : t.position}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div className="sub" style={{ fontSize: 13 }}>
                      {[m?.artist !== rel.artist ? m?.artist : "", t.duration, m?.moods?.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      {m?.bpm ? <span className="bpm">{m.bpm}</span> : <span className="tiny">–</span>}
                      <KeyBadge k={m?.key} />
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <Energy v={m?.energy} />
                    </div>
                  </td>
                </tr>,
              );
              return rows;
            })}
          </tbody>
        </table>
        {!tl.length && <div className="sub">{loading ? "Lade Tracklist …" : "Keine Tracklist bei Discogs."}</div>}

        {inColl > 0 && (
          <>
            <h2>In deiner Kiste</h2>
            <div className="group">
              {copies.map((c, i) => (
                <div key={c.instanceId} className="group-row grade-row">
                  <span style={{ width: 92 }} className="sub">
                    Zustand{copies.length > 1 ? ` ${i + 1}` : ""}
                  </span>
                  <button className="grade-pill" onClick={() => setGrading({ item: c, which: "media" })}>
                    <small>Platte</small>
                    <b>{shortGrade(c.media) ?? "–"}</b>
                  </button>
                  <button className="grade-pill" onClick={() => setGrading({ item: c, which: "sleeve" })}>
                    <small>Hülle</small>
                    <b>{shortGrade(c.sleeve) ?? "–"}</b>
                  </button>
                </div>
              ))}
              {copies.some((c) => c.note) && (
                <div className="group-row">
                  <span style={{ width: 92 }} className="sub">Notiz</span>
                  <span style={{ whiteSpace: "pre-line" }}>{copies.map((c) => c.note).filter(Boolean).join("\n")}</span>
                </div>
              )}
              <label className="group-row">
                <span style={{ width: 92 }} className="sub">Regalplatz</span>
                <input
                  className="input"
                  style={{ background: "transparent", padding: 0, minHeight: 32 }}
                  placeholder="z.B. Kallax 2 · Fach C"
                  defaultValue={meta?.shelf ?? ""}
                  onBlur={(e) => setMeta({ shelf: e.target.value })}
                  key={meta?.shelf}
                />
              </label>
              <label className="group-row">
                <span style={{ width: 92 }} className="sub">Crates</span>
                <input
                  className="input"
                  style={{ background: "transparent", padding: 0, minHeight: 32 }}
                  placeholder="z.B. Freitag, Disco"
                  defaultValue={(meta?.crates ?? []).join(", ")}
                  onBlur={(e) => setMeta({ crates: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  key={(meta?.crates ?? []).join()}
                />
              </label>
              <div className="group-row">
                <span style={{ width: 92 }} className="sub">Beschriftung</span>
                <span>{meta?.stickerPrintedAt ? `gedruckt am ${new Date(meta.stickerPrintedAt).toLocaleDateString("de-DE")}` : "noch offen"}</span>
              </div>
              <button className="group-row" onClick={() => setLendSheet(true)}>
                <span style={{ width: 92 }} className="sub">Verliehen</span>
                <span style={{ color: meta?.lentTo ? "var(--accent)" : undefined }}>
                  {meta?.lentTo ? `an ${meta.lentTo}${meta.lentAt ? ` seit ${new Date(meta.lentAt).toLocaleDateString("de-DE")}` : ""}` : "nein"}
                </span>
                <span className="chev">›</span>
              </button>
            </div>
          </>
        )}

        {(() => {
          const p = pressingInfo(rel.identifiers, rel.companies);
          if (!p.matrix.length && !p.cut.length && !p.pressed.length && !p.barcode) return null;
          return (
            <>
              <h2>Pressung</h2>
              <div className="group pressing">
                {p.matrix.length > 0 && (
                  <div className="group-row">
                    <span className="sub">Matrix</span>
                    <span className="mono">
                      {p.matrix.map((m) => (
                        <span key={m}>{m}</span>
                      ))}
                    </span>
                  </div>
                )}
                {p.cut.length > 0 && (
                  <div className="group-row">
                    <span className="sub">Geschnitten</span>
                    <span>{p.cut.join(", ")}</span>
                  </div>
                )}
                {p.pressed.length > 0 && (
                  <div className="group-row">
                    <span className="sub">Gepresst</span>
                    <span>{p.pressed.join(", ")}</span>
                  </div>
                )}
                {p.other.map((o) => (
                  <div key={o.role + o.name} className="group-row">
                    <span className="sub">{o.role}</span>
                    <span>{o.name}</span>
                  </div>
                ))}
                {p.barcode && (
                  <div className="group-row">
                    <span className="sub">Barcode</span>
                    <span className="mono">{p.barcode}</span>
                  </div>
                )}
              </div>
            </>
          );
        })()}

        {rel.videos?.length ? (
          <>
            <h2>Reinhören</h2>
            <div className="stack">
              {rel.videos.slice(0, 6).map((v) => {
                const yt = v.uri.match(/[?&]v=([\w-]{11})/)?.[1];
                return yt ? <VideoFacade key={v.uri} id={yt} title={v.title} /> : null;
              })}
            </div>
          </>
        ) : null}
      </div>

      <Sheet open={grading !== null} onClose={() => setGrading(null)}>
        {grading && (
          <div className="stack">
            <b style={{ fontSize: 18 }}>{grading.which === "media" ? "Zustand der Platte" : "Zustand der Hülle"}</b>
            <span className="sub">Nach Goldmine, wie bei Discogs. Wird dort gespeichert.</span>
            <div className="list">
              {(grading.which === "media" ? MEDIA_GRADES : SLEEVE_GRADES).map(([long, short]) => {
                const on = grading.item[grading.which] === long;
                return (
                  <button
                    key={long}
                    className={`grade-opt press${on ? " on" : ""}`}
                    onClick={async () => {
                      haptic(8);
                      const value = on ? "" : long;
                      const { item, which } = grading;
                      setGrading(null);
                      try {
                        await setCondition(item.instanceId, which, value);
                        toast(value ? `${which === "media" ? "Platte" : "Hülle"}: ${short}` : "Zustand entfernt");
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    <b className="mono">{short}</b>
                    <span>{GRADE_HINT[short] ?? long}</span>
                    {on && <span className="grade-check">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Sheet>

      <MenuSheet
        open={lendSheet}
        onClose={() => setLendSheet(false)}
        title={meta?.lentTo ? `Verliehen an ${meta.lentTo}` : "Verleihen an …"}
        items={[
          ...(meta?.lentTo ? [{ label: "Zurückbekommen", onClick: () => lendRecord(id, null).then(() => toast("Wieder in der Kiste")) }] : []),
          ...friendNames.filter((n) => n !== meta?.lentTo).map((n) => ({ label: n, onClick: () => lendRecord(id, n).then(() => toast(`An ${n} verliehen`)) })),
          {
            label: "Jemand anderes …",
            onClick: () => {
              const n = prompt("An wen verleihst du die Platte?");
              if (n?.trim()) void lendRecord(id, n.trim()).then(() => toast(`An ${n.trim()} verliehen`));
            },
          },
        ]}
      />
      <audio ref={audioRef} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => media?.type === "deezer" && setMedia({ type: "none" })} hidden />
      <Sheet open={!!edit} onClose={closeTrack}>
        {edit && (
          <TrackEdit
            t={edit}
            media={media}
            playing={playing}
            videos={rel.videos ?? []}
            onMedia={(m) => {
              audioRef.current?.pause();
              setMedia(m);
              setPlaying(m.type === "yt");
            }}
            onToggleAudio={() => {
              const a = audioRef.current;
              if (!a) return;
              if (a.paused) a.play().catch(() => undefined);
              else a.pause();
            }}
            onSave={(p) => saveTrack(edit, p).then(() => (closeTrack(), toast("Gespeichert")))}
          />
        )}
      </Sheet>
    </>
  );
}

type Media = { type: "yt"; id: string; title: string } | { type: "deezer" } | { type: "none" };

function TrackEdit({
  t,
  media,
  playing,
  videos,
  onMedia,
  onToggleAudio,
  onSave,
}: {
  t: TrackMeta;
  media: Media | null;
  playing: boolean;
  videos: { uri: string; title: string }[];
  onMedia: (m: Media) => void;
  onToggleAudio: () => void;
  onSave: (p: Partial<TrackMeta>) => void;
}) {
  const [bpm, setBpm] = useState(String(t.bpm ?? ""));
  const [key, setKey] = useState(t.key ?? "");
  const [energy, setEnergy] = useState(t.energy ?? 5);
  const [moods, setMoods] = useState((t.moods ?? []).join(", "));
  const [stars, setStars] = useState(t.stars ?? 0);
  const [notes, setNotes] = useState(t.notes ?? "");
  const [cueIn, setCueIn] = useState(t.cueIn ?? "");
  const [cueOut, setCueOut] = useState(t.cueOut ?? "");
  const history = useLiveQuery(async () => playedHistory(await db.sets.toArray()).get(t.id) ?? [], [t.id], []);
  const [pickVideo, setPickVideo] = useState(false);
  const yt = videos.filter((v) => youtubeId(v.uri));
  return (
    <div className="stack">
      <div>
        <div className="sub">
          {t.position} · {t.artist}
        </div>
        <b style={{ fontSize: 18 }}>{t.title}</b>
      </div>
      {media?.type === "yt" && (
        <iframe
          key={media.id}
          className="video"
          src={`https://www.youtube-nocookie.com/embed/${media.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
          title={media.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )}
      {media?.type === "deezer" && (
        <div className="card row" style={{ background: "var(--surface-2)" }}>
          <button className="btn primary" style={{ width: 48, height: 48, padding: 0, borderRadius: "50%", flex: "none" }} onClick={onToggleAudio} aria-label={playing ? "Pause" : "Abspielen"}>
            {playing ? "❚❚" : <IconPlay />}
          </button>
          <div>
            <b>30-Sekunden-Hörprobe</b>
            <div className="tiny">Deezer, passender Mix nach Titel und Länge</div>
          </div>
        </div>
      )}
      {media?.type === "none" && <div className="sub">Keine passende Hörprobe gefunden.</div>}
      {yt.length > 0 && (
        <button className="btn small ghost" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setPickVideo(!pickVideo)}>
          {media?.type === "yt" ? "Falsches Video? Anderes wählen" : "Video von der Discogs-Seite wählen"}
        </button>
      )}
      {pickVideo && (
        <div className="group">
          {yt.map((v) => (
            <button
              key={v.uri}
              className="group-row"
              onClick={() => {
                onMedia({ type: "yt", id: youtubeId(v.uri)!, title: v.title });
                setPickVideo(false);
              }}
            >
              <IconPlay />
              <span style={{ fontSize: 14 }}>{v.title}</span>
            </button>
          ))}
        </div>
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
          <button key={s} className="icon-btn" style={{ color: s <= stars ? "var(--accent)" : "var(--surface-3)", fontSize: 24 }} aria-label={`${s} Sterne`} onClick={() => setStars(s === stars ? 0 : s)}>
            ★
          </button>
        ))}
      </div>
      <div className="grid2">
        <label className="field">
          Rein (Cue)
          <input className="input" maxLength={60} value={cueIn} onChange={(e) => setCueIn(e.target.value)} placeholder="z. B. Intro 32 Takte" />
        </label>
        <label className="field">
          Raus (Cue)
          <input className="input" maxLength={60} value={cueOut} onChange={(e) => setCueOut(e.target.value)} placeholder="z. B. ab 5:40" />
        </label>
      </div>
      {history.length > 0 && (
        <div className="sub">
          Zuletzt gespielt: {history.slice(0, 3).map((h) => playedText(h)).join(", ")}
        </div>
      )}
      <label className="field">
        Notiz (z.B. „guter Opener“, „passt zu …“)
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button
        className="btn primary block lg"
        onClick={() =>
          onSave({
            bpm: Number(bpm.replace(",", ".")) ? Math.round(Number(bpm.replace(",", ".")) * 10) / 10 : null,
            key: key.trim() || null,
            energy,
            moods: moods.split(",").map((s) => s.trim()).filter(Boolean),
            stars,
            notes,
            cueIn: cueIn.trim() || undefined,
            cueOut: cueOut.trim() || undefined,
            bpmSource: bpm !== String(t.bpm ?? "") ? "manuell" : t.bpmSource,
            keySource: key.trim() !== (t.key ?? "") ? "manuell" : t.keySource,
            vibeSource: energy !== (t.energy ?? 5) || moods !== (t.moods ?? []).join(", ") ? "manuell" : t.vibeSource,
          })
        }
      >
        Speichern
      </button>
    </div>
  );
}

/** YouTube direkt laden, wenn eingewilligt; sonst erst nach Antippen (vorher keine Verbindung zu Google) */
function VideoFacade({ id, title }: { id: string; title: string }) {
  const [on, setOn] = useState(false);
  const allowed = ytConsent() === "yes";
  if (on || allowed)
    return <iframe className="video" src={`https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0${on ? "&autoplay=1" : ""}`} title={title} allow="autoplay; encrypted-media" allowFullScreen loading="lazy" />;
  return (
    <button className="video video-facade press" onClick={() => setOn(true)} aria-label={`${title} abspielen`}>
      <span className="video-play">
        <IconPlay />
      </span>
      <span className="video-title">{title}</span>
      <span className="tiny">Lädt das Video von YouTube</span>
    </button>
  );
}
