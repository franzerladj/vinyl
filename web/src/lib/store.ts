// Winziger globaler Zustand für Hintergrund-Jobs (Sync-Fortschritt) und Nutzer.
import { useSyncExternalStore } from "react";
import type { Me } from "./api";

export interface JobState {
  id: string;
  label: string;
  done: number;
  total: number;
  error?: string;
}

interface State {
  me: Me | null;
  jobs: Record<string, JobState>;
  toast: string | null;
}

let state: State = { me: null, jobs: {}, toast: null };
const listeners = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}

export function jobUpdate(id: string, patch: Partial<JobState> | null) {
  setState((s) => {
    const jobs = { ...s.jobs };
    if (patch === null) delete jobs[id];
    else jobs[id] = { ...(jobs[id] ?? { id, label: id, done: 0, total: 0 }), ...patch };
    return { jobs };
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3500);
}

export const username = () => state.me?.username ?? "";
