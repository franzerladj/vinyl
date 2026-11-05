// Digging-Feed: eine Platte pro Bildschirm, senkrecht wischen, Hörprobe läuft automatisch.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildQueue, digDetail, loadWeights, markSeen, markSkipped, moreLike, recordAction, type DigDetail, type DigFilter } from "../lib/dig";
import { previewUrl } from "../lib/free";
import { addToCollection, addWant } from "../lib/sync";
import { discogsSellUrl, money } from "../lib/format";
import { toast } from "../lib/store";
import { getKV, setKV } from "../lib/db";
import { ytConsent } from "../lib/theme";
import { haptic } from "../components/bits";
import { IconBack, IconCart, IconFilter, IconHeart, IconPlay, IconPlus, IconShare, IconSleeves, IconX } from "../components/icons";
import { DECADES, decadeLabel, passesPrice, top, type DigCard } from "../../../shared/dig";
import { parseDuration } from "../../../shared/match";

type Audio = "idle" | "loading" | "playing" | "paused" | "none";

export default function Dig() {
  const nav = useNavigate();
  const [cards, setCards] = useState<DigCard[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DigFilter>({});
  const style = filter.style;
  const [filterOpen, setFilterOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: number; dx: number } | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const touch = useRef<{ x: number; y: number; id: number; horizontal?: boolean } | null>(null);
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
      const f = await getKV<DigFilter>("digFilter", {});
      setFilter(f);
      setCards(await buildQueue(f));
      setLoading(false);
    })();
  }, []);

  const applyFilter = async (f: DigFilter) => {
    haptic(6);
    setFilter(f);
    setLoading(true);
    setCards([]);
    setActive(0);
    feed.current?.scrollTo({ top: 0 });
    void setKV("digFilter", f);
    setCards(await buildQueue(f));
    setLoading(false);
  };
  const changeStyle = (s?: string) => applyFilter({ ...filter, style: s });
  const extraFilters = (filter.decade ? 1 : 0) + (filter.maxPrice ? 1 : 0);

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
    // Nächste Karten vorladen. Mit Preisgrenze weiter voraus, damit zu teure vorher rausfallen.
    cards.slice(active + 1, active + (filter.maxPrice ? 6 : 3)).forEach((c) =>
      void digDetail(c.id).then((d) => {
        if (filter.maxPrice && d.lowest !== undefined && !passesPrice(d.lowest, filter.maxPrice)) setCards((cs) => cs.filter((x) => x.id !== c.id || cs.indexOf(x) <= active));
      }),
    );
    if (cards.length - active < 5 && !loadingMore.current) {
      loadingMore.current = true;
      buildQueue(filter, new Set(cards.map((c) => c.id)))
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

  /** Weg damit: Karte fliegt nach links raus, die nächste rückt an ihre Stelle */
  const skip = (c: DigCard) => {
    haptic(8);
    void recordAction(c, "skip");
    void markSkipped(c.id);
    setLeaving(c.id);
    setTimeout(() => {
      setCards((cs) => cs.filter((x) => x.id !== c.id));
      setLeaving(null);
      setDrag(null);
    }, 260);
  };

  // Wischen nach links = Weg. Senkrecht scrollt der Feed wie gewohnt.
  const onTouchStart = (c: DigCard, e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, id: c.id };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (s.horizontal === undefined && Math.hypot(dx, dy) > 10) s.horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
    if (s.horizontal) setDrag({ id: s.id, dx: Math.min(0, dx) });
  };
  const onTouchEnd = (c: DigCard) => {
    const s = touch.current;
    touch.current = null;
    if (!s?.horizontal) return;
    if ((drag?.dx ?? 0) < -90) skip(c);
    else setDrag(null);
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
          {extraFilters > 0 && (
            <button className="dig-chip on" onClick={() => setFilterOpen(true)}>
              {[filter.decade && decadeLabel(filter.decade), filter.maxPrice && `bis ${filter.maxPrice} €`].filter(Boolean).join(" · ")}
            </button>
          )}
          {[...new Set([style ?? "", "", ...styles])].map((s) => (
            <button key={s || "all"} className={`dig-chip${s === (style ?? "") ? " on" : ""}`} onClick={() => changeStyle(s || undefined)}>
              {s || "Für dich"}
            </button>
          ))}
        </div>
        <button className={`dig-icon${extraFilters ? " on" : ""}`} onClick={() => setFilterOpen(true)} aria-label="Filter">
          <IconFilter />
        </button>
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
              <button className="btn primary" onClick={() => applyFilter(filter)}>
                Nochmal
              </button>
              {extraFilters > 0 && (
                <button className="btn" onClick={() => applyFilter({ style })}>
                  Filter zurücksetzen
                </button>
              )}
            </div>
          </div>
        )}
        {cards.map((c, i) => {
          const near = Math.abs(i - active) <= 2;
          const isWanted = wanted.has(c.id);
          return (
            <section
              key={c.id}
              className={`dig-card${leaving === c.id ? " leaving" : ""}`}
              aria-label={`${c.artist} – ${c.title}`}
              onTouchStart={(e) => onTouchStart(c, e)}
              onTouchMove={onTouchMove}
              onTouchEnd={() => onTouchEnd(c)}
            >
              {near && (
                <div className="dig-swipe" style={drag?.id === c.id ? { transform: `translateX(${drag.dx}px) rotate(${drag.dx / 40}deg)`, transition: "none" } : undefined}>
                  {drag?.id === c.id && <span className="dig-nope" style={{ opacity: Math.min(1, -drag.dx / 90) }}>Weg</span>}
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
                    {(() => {
                      const dd = detail.get(c.id);
                      if (!dd || dd.lowest === undefined) return null;
                      return <div className="dig-price">{dd.lowest != null ? `ab ${money(dd.lowest, dd.currency)} · ${dd.forSale} ${dd.forSale === 1 ? "Angebot" : "Angebote"}` : "gerade kein Angebot"}</div>;
                    })()}
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
                      <IconSleeves />
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
                </div>
              )}
            </section>
          );
        })}
      </div>

      {filterOpen && (
        <div className="dig-sheet-bg" onClick={() => setFilterOpen(false)}>
          <div className="dig-sheet stack" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" />
            <b style={{ fontSize: 18 }}>Filter</b>
            <span className="sub">Jahrzehnt</span>
            <div className="chips">
              {[undefined, ...DECADES].map((d) => (
                <button key={d ?? 0} className={`chip ${filter.decade === d ? "on" : ""}`} onClick={() => setFilter({ ...filter, decade: d })}>
                  {d ? decadeLabel(d) : "Alle"}
                </button>
              ))}
            </div>
            <span className="sub">Günstigstes Angebot</span>
            <div className="chips">
              {[undefined, 10, 20, 40, 80].map((p) => (
                <button key={p ?? 0} className={`chip ${filter.maxPrice === p ? "on" : ""}`} onClick={() => setFilter({ ...filter, maxPrice: p })}>
                  {p ? `bis ${p} €` : "Egal"}
                </button>
              ))}
            </div>
            {filter.maxPrice ? <span className="tiny sub">Platten ohne Angebot oder darüber werden übersprungen.</span> : null}
            <button
              className="btn primary block"
              onClick={() => {
                setFilterOpen(false);
                void applyFilter(filter);
              }}
            >
              Anwenden
            </button>
          </div>
        </div>
      )}

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
