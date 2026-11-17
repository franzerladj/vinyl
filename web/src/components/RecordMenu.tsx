// Langes Drücken auf eine Platte (überall, wo sie verlinkt ist): Schnellmenü wie in iOS,
// mit großer Vorschau und den häufigsten Aktionen. Am Computer per Rechtsklick.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { db, type Release } from "../lib/db";
import { play } from "../lib/player";
import { previewUrl } from "../lib/free";
import { addWant, removeWant } from "../lib/sync";
import { discogsReleaseUrl } from "../lib/format";
import { toast } from "../lib/store";
import { haptic, keepParens, overlayOpen, useBackClose, useSwipeDown } from "./bits";
import { IconHeart, IconPlay, IconShare, IconRecord } from "./icons";

type Ctx = { rel: Release; owned: boolean; wanted: boolean; track?: { title: string; artist: string; deezerId?: number; id: string } };

const SKIP = ".dig, .sheet, [role=dialog], .ys, .pager-pane.peek";

export function RecordMenu() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    let suppress = -Infinity;
    const open = async (a: HTMLAnchorElement) => {
      const id = Number(a.getAttribute("href")!.split("/")[2]);
      if (!id) return;
      const rel = await db.releases.get(id);
      if (!rel) return;
      const [own, want, tracks] = await Promise.all([db.collection.where("releaseId").equals(id).count(), db.wants.get(id), db.tracks.where("releaseId").equals(id).toArray()]);
      const t = tracks.sort((x, y) => x.position.localeCompare(y.position, "de", { numeric: true })).find((x) => x.deezerId) ?? tracks[0];
      haptic(14);
      suppress = performance.now();
      setCtx({ rel, owned: own > 0, wanted: Boolean(want), track: t && { title: t.title, artist: t.artist, deezerId: t.deezerId ?? undefined, id: t.id } });
    };
    const target = (e: Event) => {
      const el = e.target as HTMLElement | null;
      const a = el?.closest<HTMLAnchorElement>('a[href^="/release/"]');
      return a && !a.closest(SKIP) ? a : null;
    };
    const down = (e: TouchEvent) => {
      const a = target(e);
      if (!a || e.touches.length !== 1 || overlayOpen()) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      timer = setTimeout(() => void open(a), 480);
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) {
        clearTimeout(timer);
        start = null;
      }
    };
    const up = () => {
      clearTimeout(timer);
      start = null;
    };
    // Nach dem Öffnen kein Tippen auf die Platte auslösen; Rechtsklick und Android-Langdruck öffnen auch
    const click = (e: MouseEvent) => {
      if (performance.now() - suppress < 600) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const context = (e: MouseEvent) => {
      const a = target(e);
      if (!a) return;
      e.preventDefault();
      if (performance.now() - suppress > 600) void open(a);
    };
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    document.addEventListener("touchcancel", up, { passive: true });
    document.addEventListener("click", click, true);
    document.addEventListener("contextmenu", context);
    return () => {
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", up);
      document.removeEventListener("click", click, true);
      document.removeEventListener("contextmenu", context);
    };
  }, []);
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCtx(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx]);
  const body = useRef<HTMLDivElement>(null);
  useSwipeDown(body, () => setCtx(null), Boolean(ctx));
  useBackClose(Boolean(ctx), () => setCtx(null));
  if (!ctx) return null;
  const { rel, owned, wanted, track } = ctx;
  const close = () => setCtx(null);
  const act = (fn: () => void) => () => {
    haptic(6);
    close();
    fn();
  };
  const items: { label: string; icon: React.ReactNode; run: () => void }[] = [
    {
      label: "Anhören",
      icon: <IconPlay />,
      run: () => {
        const title = track?.title ?? rel.tracklist?.[0]?.title ?? rel.title;
        const artist = track?.artist ?? rel.artist;
        void play({ src: track?.deezerId ? `/api/audio/preview/${track.deezerId}` : previewUrl(artist, title), title, artist, cover: rel.cover || rel.thumb, releaseId: rel.id, trackId: track?.id });
      },
    },
    { label: "Platte öffnen", icon: <IconRecord />, run: () => nav(`/release/${rel.id}`, { viewTransition: true }) },
    ...(!owned
      ? [
          {
            label: wanted ? "Von der Wantlist nehmen" : "Auf die Wantlist",
            icon: <IconHeart />,
            run: () =>
              void (wanted ? removeWant(rel.id) : addWant(rel.id)).then(
                () => toast(wanted ? "Von der Wantlist genommen" : "Auf der Wantlist"),
                (e: Error) => toast(e.message),
              ),
          },
        ]
      : []),
    {
      label: "Teilen",
      icon: <IconShare />,
      run: () => {
        const url = discogsReleaseUrl(rel.id);
        if (navigator.share) void navigator.share({ title: `${rel.artist} – ${rel.title}`, url }).catch(() => undefined);
        else void navigator.clipboard.writeText(url).then(() => toast("Link kopiert"));
      },
    },
  ];
  return createPortal(
    <div className="ctx" onClick={close} role="dialog" aria-modal="true" aria-label={rel.title}>
      <div className="ctx-body" ref={body} onClick={(e) => e.stopPropagation()}>
        <div className="ctx-preview">
          {(rel.cover || rel.thumb) && <img src={rel.cover || rel.thumb} alt="" />}
          <div>
            <b>{keepParens(rel.title)}</b>
            <span>{[rel.artist, rel.labels[0]?.name.replace(/\s\(\d+\)$/, ""), rel.year || null].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <div className="ctx-menu">
          {items.map((i) => (
            <button key={i.label} onClick={act(i.run)}>
              <span>{i.label}</span>
              {i.icon}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
