// Digging-Feed: eine Platte pro Bildschirm, senkrecht wischen, Hörprobe läuft automatisch.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildQueue, digDetail, loadWeights, markSeen, markSkipped, moreLike, recordAction, type DigDetail } from "../lib/dig";
import { previewUrl } from "../lib/free";
import { addToCollection, addWant } from "../lib/sync";
import { discogsSellUrl } from "../lib/format";
import { toast } from "../lib/store";
import { getKV, setKV } from "../lib/db";
import { ytConsent } from "../lib/theme";
import { haptic } from "../components/bits";
import { IconBack, IconCart, IconHeart, IconPlay, IconPlus, IconShare, IconSparkle, IconX } from "../components/icons";
import { top, type DigCard } from "../../../shared/dig";
import { parseDuration } from "../../../shared/match";

type Audio = "idle" | "loading" | "playing" | "paused" | "none";

export default function Dig() {
  const nav = useNavigate();
  const [cards, setCards] = useState<DigCard[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [style, setStyle] = useState<string | undefined>();
  const [styles, setStyles] = useState<string[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [audioState, setAudioState] = useState<Audio>("idle");
  const [detail, setDetail] = useState<Map<number, DigDetail>>(new Map());
  const [wanted, setWanted] = useState<Set<number>>(new Set());
  const [burst, setBurst] = useState<number | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);
  const shownAt = useRef(Date.now());
  const lastTap = useRef(0);

  // Start: gemerkten Filter und Lieblings-Styles laden
  useEffect(() => {
    void (async () => {
      const w = await loadWeights();
      setStyles(top(w.style, 8));
      const f = await getKV<{ style?: string }>("digFilter", {});
      setStyle(f.style);
      setCards(await buildQueue(f));
      setLoading(false);
    })();
  }, []);

  const changeStyle = async (s?: string) => {
    haptic(6);
    setStyle(s);
    setLoading(true);
    setCards([]);
    setActive(0);
    feed.current?.scrollTo({ top: 0 });
    void setKV("digFilter", { style: s });
    setCards(await buildQueue({ style: s }));
    setLoading(false);
  };

  // Aktive Karte über die Scroll-Position bestimmen
  useEffect(() => {
    const el = feed.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollTop / el.clientHeight);
      setActive((a) => (a === i ? a : i));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [loading]);

  // Kartenwechsel: Hörprobe laden, Verweildauer lernen, vorladen, nachladen
  const current = cards[active];
  useEffect(() => {
    if (!current) return;
    const started = Date.now();
    shownAt.current = started;
    setVideo(null);
    void markSeen(current.id);
    let cancelled = false;
    const a = audio.current!;
    a.pause();
    setAudioState("loading");
    digDetail(current.id).then((d) => {
      if (cancelled) return;
      setDetail((m) => new Map(m).set(current.id, d));
      const t = d.tracks[0];
      a.src = previewUrl(current.artist, t?.title ?? current.title, parseDuration(t?.duration));
      if (unlocked) a.play().catch(() => setAudioState("paused"));
      else setAudioState("paused");
    });
    // Nächste zwei Karten vorladen
    cards.slice(active + 1, active + 3).forEach((c) => void digDetail(c.id));
    if (cards.length - active < 5 && !loadingMore.current) {
      loadingMore.current = true;
      buildQueue({ style }, new Set(cards.map((c) => c.id)))
        .then((more) => setCards((cs) => [...cs, ...more.filter((m) => !cs.some((c) => c.id === m.id))]))
        .finally(() => (loadingMore.current = false));
    }
    return () => {
      cancelled = true;
      if (Date.now() - started > 8000) void recordAction(current, "dwell");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Keine Hörprobe, aber YouTube erlaubt: Video gleich zeigen
  useEffect(() => {
    const v = current && detail.get(current.id)?.video;
    if (audioState === "none" && v && ytConsent() === "yes") setVideo(v);
  }, [audioState, current, detail]);

  // Audio-Ereignisse
  useEffect(() => {
    const a = audio.current!;
    const on = () => setAudioState("playing");
    const off = () => setAudioState((s) => (s === "none" ? s : "paused"));
    const err = () => setAudioState("none");
    a.addEventListener("playing", on);
    a.addEventListener("pause", off);
    a.addEventListener("error", err);
    return () => {
      a.removeEventListener("playing", on);
      a.removeEventListener("pause", off);
      a.removeEventListener("error", err);
      a.pause();
    };
  }, []);

  /** iPhone: Ton gibt es erst nach einer Berührung. Danach spielt dasselbe Audio-Element jede Karte ab. */
  const toggleSound = () => {
    const a = audio.current!;
    setUnlocked(true);
    if (audioState === "playing") a.pause();
    else if (audioState !== "none") a.play().catch(() => setAudioState("none"));
  };

  const next = () => feed.current?.scrollBy({ top: feed.current.clientHeight, behavior: "smooth" });

  const want = async (c: DigCard) => {
    if (wanted.has(c.id)) return;
    haptic(20);
    setWanted((s) => new Set(s).add(c.id));
    setBurst(c.id);
    setTimeout(() => setBurst(null), 900);
    void recordAction(c, "want");
    try {
      await addWant(c.id);
    } catch (e) {
      setWanted((s) => {
        const n = new Set(s);
        n.delete(c.id);
        return n;
      });
      toast((e as Error).message);
    }
  };

  const collect = async (c: DigCard) => {
    if (!confirm(`„${c.title}“ zur Sammlung hinzufügen?`)) return;
    haptic(20);
    void recordAction(c, "collect");
    try {
      await addToCollection(c.id);
      toast("In der Sammlung");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const skip = (c: DigCard) => {
    haptic(8);
    void recordAction(c, "skip");
    void markSkipped(c.id);
    next();
  };

  const more = async (c: DigCard) => {
    haptic(12);
    void recordAction(c, "more");
    toast("Mehr davon kommt gleich");
    const extra = await moreLike(c, new Set(cards.map((x) => x.id)));
    if (!extra.length) return toast("Nichts Neues gefunden");
    setCards((cs) => [...cs.slice(0, active + 1), ...extra, ...cs.slice(active + 1).filter((x) => !extra.some((e) => e.id === x.id))]);
  };

  const share = async (c: DigCard) => {
    const url = `https://www.discogs.com/release/${c.id}`;
    try {
      if (navigator.share) await navigator.share({ title: `${c.artist} – ${c.title}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link kopiert");
      }
    } catch {
      /* abgebrochen */
    }
  };

  // Einfaches Tippen: Ton an/aus, sofort (iOS erlaubt play() nur direkt im Tipp).
  // Doppeltippen: auf die Wantlist, der zweite Tipp stellt den Ton wieder her.
  const onCardTap = (c: DigCard) => {
    const now = Date.now();
    toggleSound();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      void want(c);
      return;
    }
    lastTap.current = now;
  };

  const d = current ? detail.get(current.id) : undefined;

  return (
    <div className="dig">
      <audio ref={audio} preload="auto" playsInline loop />
      <header className="dig-top">
        <button className="dig-icon" onClick={() => nav(-1)} aria-label="Zurück">
          <IconBack />
        </button>
        <div className="dig-chips">
          {/* Aktiver Filter zuerst, dann „Für dich“ und die Lieblings-Styles */}
          {[...new Set([style ?? "", "", ...styles])].map((s) => (
            <button key={s || "all"} className={`dig-chip${s === (style ?? "") ? " on" : ""}`} onClick={() => changeStyle(s || undefined)}>
              {s || "Für dich"}
            </button>
          ))}
        </div>
      </header>

      <div className="dig-feed" ref={feed}>
        {loading && (
          <div className="dig-card">
            <div className="dig-loading">
              <span className="spinner" />
              Kiste wird gepackt …
            </div>
          </div>
        )}
        {!loading && !cards.length && (
          <div className="dig-card">
            <div className="dig-loading">
              Gerade nichts gefunden.
              <button className="btn primary" onClick={() => changeStyle(style)}>
                Nochmal
              </button>
            </div>
          </div>
        )}
        {cards.map((c, i) => {
          const near = Math.abs(i - active) <= 2;
          const isWanted = wanted.has(c.id);
          return (
            <section key={c.id} className="dig-card" aria-label={`${c.artist} – ${c.title}`}>
              {near && (
                <>
                  <img className="dig-bg" src={c.cover} alt="" />
                  <div className="dig-shade" />
                  <div className="dig-stage" onClick={() => onCardTap(c)}>
                    {i === active && video ? (
                      <iframe className="dig-video" src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1&playsinline=1&rel=0`} title={c.title} allow="autoplay; encrypted-media" allowFullScreen />
                    ) : (
                      <img className={`dig-cover${i === active && audioState === "playing" ? " playing" : ""}`} src={c.cover} alt="" />
                    )}
                    {burst === c.id && <span className="dig-burst">♥</span>}
                  </div>
                  <div className="dig-info">
                    <span className="dig-reason">{c.reason}</span>
                    <button className="dig-title" onClick={() => nav(`/release/${c.id}`, { viewTransition: true })}>
                      <b>{c.title}</b>
                      <span>{c.artist}</span>
                    </button>
                    <div className="dig-meta">
                      {[c.label, c.catno, c.year, c.country].filter(Boolean).join(" · ")}
                    </div>
                    <div className="dig-tags">
                      {c.styles.slice(0, 3).map((s) => (
                        <span key={s}>{s}</span>
                      ))}
                      {c.want ? <span>♥ {c.want} wollen sie</span> : null}
                    </div>
                    {i === active && (
                      <div className="dig-sound">
                        {audioState === "none" ? (
                          d?.video ? (
                            <button onClick={() => setVideo(d.video!)}>
                              <IconPlay /> Video ansehen
                            </button>
                          ) : (
                            <span>Keine Hörprobe</span>
                          )
                        ) : (
                          <button onClick={toggleSound}>
                            {audioState === "playing" ? "❚❚ Pause" : audioState === "loading" ? "Lädt …" : unlocked ? "▶ Abspielen" : "▶ Tippen zum Hören"}
                            {d?.tracks[0] && <small> · {d.tracks[0].position} {d.tracks[0].title}</small>}
                          </button>
                        )}
                        {d && d.tracks.length > 0 && (
                          <button className="dig-link" onClick={() => setSheet(c.id)}>
                            {d.tracks.length} Tracks
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="dig-rail">
                    <button className={isWanted ? "on" : ""} onClick={() => want(c)} aria-label="Auf die Wantlist">
                      <IconHeart />
                      <small>{isWanted ? "Gemerkt" : "Want"}</small>
                    </button>
                    <button onClick={() => collect(c)} aria-label="Zur Sammlung">
                      <IconPlus />
                      <small>Hab ich</small>
                    </button>
                    <a href={discogsSellUrl(c.id)} target="_blank" rel="noreferrer" aria-label="Angebote">
                      <IconCart />
                      <small>Kaufen</small>
                    </a>
                    <button onClick={() => more(c)} aria-label="Mehr davon">
                      <IconSparkle />
                      <small>Mehr</small>
                    </button>
                    <button onClick={() => share(c)} aria-label="Teilen">
                      <IconShare />
                      <small>Teilen</small>
                    </button>
                    <button onClick={() => skip(c)} aria-label="Nicht mein Ding">
                      <IconX />
                      <small>Weg</small>
                    </button>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      {sheet != null && detail.get(sheet) && (
        <div className="dig-sheet-bg" onClick={() => setSheet(null)}>
          <div className="dig-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <b>{cards.find((c) => c.id === sheet)?.title}</b>
            <div className="list" style={{ marginTop: 8 }}>
              {detail.get(sheet)!.tracks.map((t) => {
                const c = cards.find((x) => x.id === sheet)!;
                return (
                  <button
                    key={t.position + t.title}
                    className="dig-track"
                    onClick={() => {
                      const a = audio.current!;
                      setUnlocked(true);
                      a.src = previewUrl(c.artist, t.title, parseDuration(t.duration));
                      a.play().catch(() => setAudioState("none"));
                    }}
                  >
                    <span className="sub">{t.position}</span>
                    <span>{t.title}</span>
                    <span className="sub">{t.duration}</span>
                  </button>
                );
              })}
            </div>
            <button className="btn block" style={{ marginTop: 12 }} onClick={() => nav(`/release/${sheet}`)}>
              Alle Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
