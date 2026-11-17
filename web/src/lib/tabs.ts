// Jeder Tab behält seinen Stand wie in nativen Apps: zuletzt offene Seite und Scroll-Position.
// Tab antippen = dorthin zurück, wo du warst. Aktiven Tab nochmal antippen = zu seiner Startseite (bzw. nach oben).
export type TabId = "home" | "dig" | "coll" | "sets" | "friends";

export const TABS: { id: TabId; root: string; owns: (p: string) => boolean }[] = [
  { id: "home", root: "/", owns: (p) => p === "/" },
  { id: "dig", root: "/dig", owns: (p) => p === "/dig" },
  { id: "coll", root: "/collection", owns: (p) => /^\/(collection|wants|shop|labels?|stickers)(\/|$)/.test(p) },
  { id: "sets", root: "/sets", owns: (p) => /^\/sets(\/|$)/.test(p) },
  { id: "friends", root: "/friends", owns: (p) => /^\/friends(\/|$)/.test(p) },
];

interface State {
  current: TabId;
  last: Partial<Record<TabId, string>>;
}
const KEY = "crate:tabs";
const state: State = (() => {
  try {
    return { current: "home", last: {}, ...JSON.parse(sessionStorage.getItem(KEY) ?? "{}") } as State;
  } catch {
    return { current: "home", last: {} };
  }
})();
const save = () => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* egal */
  }
};

/** Zu welchem Tab gehört die Seite? Seiten ohne festen Tab (Platte, Suche, Einstellungen …) gehören zu dem, aus dem du kommst. */
export const tabOf = (path: string): TabId => TABS.find((t) => t.owns(path))?.id ?? state.current;

/** Bei jedem Seitenwechsel aufrufen */
export function noteLocation(path: string, full: string) {
  const next = tabOf(path);
  if (next === "dig") noteDigEntry(state.current);
  state.current = next;
  state.last[state.current] = full;
  save();
}

/** Scroll-Position je Adresse (für die Rückkehr in einen Tab) */
const scrollByPath = new Map<string, number>();
export const rememberScroll = (full: string, y: number) => scrollByPath.set(full, y);
let pending: { full: string; y: number } | null = null;
/** Einmalig: beim Wechsel in einen Tab dessen alte Position anfahren */
export function takePendingScroll(full: string): number | null {
  if (!pending || pending.full !== full) return null;
  const y = pending.y;
  pending = null;
  return y;
}

/** Ziel beim Antippen eines Tabs. null = schon auf der Startseite des Tabs, dann nach oben scrollen. */
export function tabTarget(id: TabId, full: string): string | null {
  const tab = TABS.find((t) => t.id === id)!;
  if (state.current === id) return full === tab.root ? null : tab.root;
  const dest = state.last[id] ?? tab.root;
  pending = { full: dest, y: scrollByPath.get(dest) ?? 0 };
  if (id === "dig") noteDigEntry(state.current);
  // Gleich umstellen: die Zielseite (z. B. eine Platte) hat keinen eigenen Tab und gehört dann hierher
  state.current = id;
  save();
  return dest;
}

/** Diggen verlassen: zurück zum Tab, aus dem man kam (mit dessen Seite und Scroll-Position) */
let beforeDig: TabId = "home";
export function noteDigEntry(from: TabId) {
  if (from !== "dig") beforeDig = from;
}
export function leaveDig(): string {
  const id = beforeDig;
  const tab = TABS.find((t) => t.id === id)!;
  const dest = state.last[id] ?? tab.root;
  pending = { full: dest, y: scrollByPath.get(dest) ?? 0 };
  state.current = id;
  save();
  return dest;
}
