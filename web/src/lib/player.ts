// Ein Player für die ganze App: ein einziges Audio-Element (iOS spielt nur nach Tippen und mag keine neuen
// Elemente), das beim Seitenwechsel weiterläuft. Die Leiste über der Tab-Leiste zeigt, was gerade läuft.
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
}

let state: PlayerState = { now: null, playing: false, failed: false };
const subs = new Set<() => void>();
const set = (p: Partial<PlayerState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

let el: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "none";
  el.addEventListener("play", () => set({ playing: true, failed: false }));
  el.addEventListener("pause", () => set({ playing: false }));
  el.addEventListener("ended", () => set({ playing: false }));
  el.addEventListener("error", () => state.now && set({ playing: false, failed: true }));
  return el;
}

/** Abspielen (direkt aus der Tipp-Geste aufrufen). Gibt false zurück, wenn der Browser nicht abspielt. */
export function play(now: NowPlaying): Promise<boolean> {
  const a = audio();
  if (state.now?.src !== now.src) a.src = now.src;
  set({ now, failed: false });
  return a.play().then(
    () => true,
    () => false,
  );
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
  set({ now: null, playing: false, failed: false });
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}
