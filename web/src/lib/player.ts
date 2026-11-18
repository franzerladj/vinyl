// Ein Player für die ganze App: ein einziges Audio-Element (iOS spielt nur nach Tippen und mag keine neuen
// Elemente), das beim Seitenwechsel weiterläuft. Die Leiste über der Tab-Leiste zeigt, was gerade läuft,
// hochgezogen wird daraus der große Player (NowPlaying.tsx) mit Spulen, Vor und Zurück.
import { useSyncExternalStore } from "react";

export interface NowPlaying {
  src: string;
  title: string;
  artist: string;
  cover?: string;
  releaseId: number;
  trackId?: string;
}
interface PlayerState {
  now: NowPlaying | null;
  playing: boolean;
  /** Hörprobe ließ sich nicht laden */
  failed: boolean;
  /** Was davor und danach kommt (Tracks der Platte oder des Sets) */
  queue: NowPlaying[];
  index: number;
  /** Großer Player offen */
  full: boolean;
}

let state: PlayerState = { now: null, playing: false, failed: false, queue: [], index: -1, full: false };
const subs = new Set<() => void>();
const set = (p: Partial<PlayerState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

/** Läuft der Player von selbst weiter (oder per Vor/Zurück), überspringt er Tracks ohne Hörprobe in dieser Richtung */
let skipDir: 1 | -1 | 0 = 0;
let skipped = 0;
const MAX_SKIPS = 8;

const timeSubs = new Set<() => void>();
let el: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "none";
  el.addEventListener("play", () => set({ playing: true, failed: false }));
  el.addEventListener("playing", () => {
    skipDir = 0;
    skipped = 0;
  });
  el.addEventListener("pause", () => set({ playing: false }));
  el.addEventListener("ended", () => {
    set({ playing: false });
    // Nächster Track der Platte oder des Sets
    if (state.index >= 0 && state.index < state.queue.length - 1) step(1, true);
  });
  el.addEventListener("error", () => {
    if (!state.now) return;
    if (skipDir && skipped < MAX_SKIPS && step(skipDir, true)) return;
    skipDir = 0;
    set({ playing: false, failed: true });
  });
  for (const ev of ["timeupdate", "durationchange", "seeked", "emptied"]) el.addEventListener(ev, () => timeSubs.forEach((f) => f()));
  mediaSession();
  return el;
}

/** Sperrbildschirm und Kopfhörer-Tasten */
function mediaSession() {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return;
  const on = (action: MediaSessionAction, fn: () => void) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* Aktion kennt der Browser nicht */
    }
  };
  on("play", () => void el?.play().catch(() => undefined));
  on("pause", () => el?.pause());
  on("nexttrack", () => next());
  on("previoustrack", () => prev());
}
function announce(now: NowPlaying) {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms || typeof MediaMetadata === "undefined") return;
  try {
    ms.metadata = new MediaMetadata({ title: now.title, artist: now.artist, artwork: now.cover ? [{ src: now.cover }] : [] });
  } catch {
    /* egal */
  }
}

function start(now: NowPlaying): Promise<boolean> {
  const a = audio();
  if (state.now?.src !== now.src || state.failed) a.src = now.src;
  set({ now, failed: false });
  announce(now);
  return a.play().then(
    () => true,
    () => false,
  );
}

const same = (a: NowPlaying, b: NowPlaying) => (a.trackId && b.trackId ? a.trackId === b.trackId : a.src === b.src);

/**
 * Abspielen (direkt aus der Tipp-Geste aufrufen). Gibt false zurück, wenn der Browser nicht abspielt.
 * queue: die Tracks drumherum (Platte, Set), für Vor/Zurück und automatisches Weiterlaufen.
 */
export function play(now: NowPlaying, queue?: NowPlaying[]): Promise<boolean> {
  skipDir = 0;
  skipped = 0;
  const q = queue?.length ? queue : state.queue.some((x) => same(x, now)) ? state.queue : [now];
  const index = Math.max(0, q.findIndex((x) => same(x, now)));
  set({ queue: q, index });
  return start(q[index] && same(q[index], now) ? { ...q[index], ...now } : now);
}

function step(dir: 1 | -1, auto = false): boolean {
  const i = state.index + dir;
  if (i < 0 || i >= state.queue.length) return false;
  skipDir = dir;
  skipped = auto ? skipped + 1 : 0;
  set({ index: i });
  void start(state.queue[i]);
  return true;
}

export const hasNext = () => state.index >= 0 && state.index < state.queue.length - 1;
export const hasPrev = () => state.index > 0;
export function next() {
  step(1);
}
/** Zurück: nach ein paar Sekunden erst an den Anfang, sonst zum Track davor */
export function prev() {
  if (el && el.currentTime > 3) {
    el.currentTime = 0;
    return;
  }
  if (!step(-1) && el) el.currentTime = 0;
}

/** An eine Stelle springen (0 bis 1) */
export function seek(fraction: number) {
  if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
  el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
}

export function toggle() {
  const a = audio();
  if (!state.now) return;
  if (a.paused) void a.play().catch(() => undefined);
  else a.pause();
}

export function pause() {
  el?.pause();
}

/** Leiste schließen und Ton aus */
export function stop() {
  el?.pause();
  skipDir = 0;
  set({ now: null, playing: false, failed: false, queue: [], index: -1, full: false });
}

export const openFull = () => state.now && set({ full: true });
export const closeFull = () => set({ full: false });

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

let timeSnap = { time: 0, duration: 0 };
const readTime = () => {
  const time = el?.currentTime ?? 0;
  const duration = el && Number.isFinite(el.duration) ? el.duration : 0;
  if (time !== timeSnap.time || duration !== timeSnap.duration) timeSnap = { time, duration };
  return timeSnap;
};
/** Laufzeit und Länge der Hörprobe (aktualisiert sich ein paar Mal pro Sekunde) */
export function usePlayerTime(): { time: number; duration: number } {
  return useSyncExternalStore(
    (f) => {
      timeSubs.add(f);
      return () => timeSubs.delete(f);
    },
    readTime,
  );
}
