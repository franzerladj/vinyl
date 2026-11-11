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
  /** Gesetzt, wenn eine neue App-Version bereitsteht */
  updateReady: (() => void) | null;
  /** Offene Rückfrage im Crate-Stil (statt confirm/prompt des Browsers) */
  ask: AskState | null;
}

export interface AskOptions {
  title: string;
  body?: string;
  ok?: string;
  cancel?: string;
  /** Rote Bestätigung für Löschen, Abmelden … */
  danger?: boolean;
  /** Mit Eingabefeld (ersetzt prompt) */
  input?: { placeholder?: string; value?: string };
}
export interface AskState extends AskOptions {
  id: number;
  resolve: (v: string | null) => void;
}

let state: State = { me: null, jobs: {}, toast: null, updateReady: null, ask: null };
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

let askId = 0;
function openAsk(o: AskOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // Eine ältere, noch offene Frage gilt als abgebrochen
    state.ask?.resolve(null);
    const id = ++askId;
    setState({
      ask: {
        ...o,
        id,
        resolve: (v) => {
          if (state.ask?.id === id) setState({ ask: null });
          resolve(v);
        },
      },
    });
  });
}

/** Ja/Nein-Frage im Crate-Stil. Ergebnis true = bestätigt. */
export const ask = (o: AskOptions) => openAsk(o).then((v) => v !== null);
/** Frage mit Eingabefeld. Ergebnis: eingegebener Text oder null (abgebrochen). */
export const askText = (o: AskOptions) => openAsk({ ...o, input: o.input ?? {} });
