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
import { haptic, keepParens, overlayOpen, Sheet, useBackClose, useSwipeDown } from "./bits";
import { IconFolder, IconHeart, IconPlay, IconShare, IconRecord, IconSleeves, IconUser } from "./icons";
import { RecommendSheet } from "./Buzz";
import { FolderChooser } from "./Folders";
import { cachedFolders, folderIdFor, moveToFolder, setWantFolder } from "../lib/folders";
import { customFolders, NO_FOLDER, wantFolderOf } from "../../../shared/folders";
import { useLiveQuery } from "dexie-react-hooks";

type Ctx = { rel: Release; owned: boolean; wanted: boolean; folder: string | null; track?: { title: string; artist: string; deezerId?: number; id: string } };

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
      // Aktueller Ordner: bei Platten aus der Sammlung der Discogs-Ordner, bei Wants die Marke in der Notiz
      let folder: string | null = null;
      if (own > 0) {
        const copies = await db.collection.where("releaseId").equals(id).toArray();
        folder = customFolders(await cachedFolders()).find((f) => copies.some((c) => c.folderId === f.id))?.name ?? null;
      } else if (want) folder = wantFolderOf(want.notes);
      setCtx({ rel, owned: own > 0, wanted: Boolean(want), folder, track: t && { title: t.title, artist: t.artist, deezerId: t.deezerId ?? undefined, id: t.id } });
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
  const [rec, setRec] = useState<Release | null>(null);
  const [filing, setFiling] = useState<{ id: number; kind: "coll" | "want"; current: string | null } | null>(null);
  const [crating, setCrating] = useState<Release | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useSwipeDown(body, () => setCtx(null), Boolean(ctx));
  useBackClose(Boolean(ctx), () => setCtx(null));
  if (!ctx)
    return (
      <>
        <RecommendSheet release={rec} onClose={() => setRec(null)} />
        <FolderChooser
          open={Boolean(filing)}
          onClose={() => setFiling(null)}
          kind={filing?.kind ?? "coll"}
          current={filing?.current ?? null}
          onPick={(name) => {
            if (!filing) return;
            const id = filing.id;
            const job = filing.kind === "want" ? setWantFolder([id], name) : (name ? folderIdFor(name) : Promise.resolve(NO_FOLDER)).then((fid) => moveToFolder([id], fid));
            job.then(
              () => toast(name ? `In „${name}“ einsortiert` : "Ohne Ordner"),
              (e) => toast((e as Error).message),
            );
          }}
        />
        <CrateSheet release={crating} onClose={() => setCrating(null)} />
      </>
    );
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
    ...(owned || wanted ? [{ label: ctx.folder ? `Ordner: ${ctx.folder}` : "In einen Ordner legen", icon: <IconFolder />, run: () => setFiling({ id: rel.id, kind: owned ? ("coll" as const) : ("want" as const), current: ctx.folder }) }] : []),
    ...(owned ? [{ label: "In die Kiste für ein Set", icon: <IconSleeves />, run: () => setCrating(rel) }] : []),
    { label: "Einem Freund empfehlen", icon: <IconUser />, run: () => setRec(rel) },
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

/** Platte in die Kiste eines Sets legen: anstehende Sets zuerst, dann die neuesten */
function CrateSheet({ release, onClose }: { release: Release | null; onClose: () => void }) {
  const sets = useLiveQuery(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const all = await db.sets.toArray();
    const next = all.filter((x) => x.date && x.date >= today).sort((a, b) => a.date!.localeCompare(b.date!));
    const rest = all.filter((x) => !next.includes(x)).sort((a, b) => b.createdAt - a.createdAt);
    return [...next, ...rest].slice(0, 8);
    // Bei jedem Öffnen neu lesen
  }, [release?.id]);
  const add = async (setId: number, name: string) => {
    if (!release) return;
    const cur = await db.sets.get(setId);
    if (!cur) return;
    const crate = cur.crateIds ?? [];
    haptic(8);
    onClose();
    if (crate.includes(release.id)) return toast(`Liegt schon in der Kiste für „${name}“`);
    await db.sets.update(setId, { crateIds: [...crate, release.id] });
    toast(`In der Kiste für „${name}“`);
  };
  return (
    <Sheet open={Boolean(release)} onClose={onClose}>
      <div className="sheet-title">
        <h3>In welche Kiste?</h3>
      </div>
      {sets && sets.length > 0 ? (
        <div className="option-list">
          {sets.map((x) => (
            <button key={x.id} className="option" onClick={() => void add(x.id!, x.name || "Set")}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {x.name || "Set"}
                <small style={{ display: "block", color: "var(--text-2)", fontSize: 13 }}>
                  {[x.date ? new Date(x.date).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : null, `${(x.crateIds ?? []).length} in der Kiste`, release && (x.crateIds ?? []).includes(release.id) ? "liegt schon drin" : null].filter(Boolean).join(" · ")}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="sub">Du hast noch kein Set. Leg unter „Sets“ eines an, dann kannst du Platten von überall in seine Kiste legen.</p>
      )}
    </Sheet>
  );
}
