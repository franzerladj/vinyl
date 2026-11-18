// Wischen zwischen den Hauptbereichen. Gedacht als ein langer Streifen:
// Start | Sammlung | Wantlist | Meine Sets | Nächster Track | Freunde
// Innerhalb von „Platten“ und „Sets“ blättert der Pager; an dessen Rand geht es zum Nachbarbereich weiter.
// Diggen liegt nicht im Streifen: dort gehört der seitliche Wisch den Platten (Like, Skip).

export interface TabStep {
  path: string;
  /** Welche Seite des Pagers zuerst zu sehen ist (kommt man von rechts, die letzte) */
  state?: { pane?: number };
}

/** Nachbarbereich in Wischrichtung: dir +1 = nach links wischen (weiter), −1 = nach rechts (zurück) */
export function neighborTab(pathname: string, dir: 1 | -1): TabStep | null {
  switch (pathname) {
    case "/":
      return dir === 1 ? { path: "/collection" } : null;
    case "/collection":
    case "/wants":
      return dir === 1 ? { path: "/sets", state: { pane: 0 } } : { path: "/" };
    case "/sets":
      return dir === 1 ? { path: "/friends" } : { path: "/wants" };
    case "/friends":
      return dir === 1 ? null : { path: "/sets", state: { pane: 1 } };
    default:
      return null;
  }
}

/** Kann der Pager der Seite in diese Richtung noch selbst blättern? */
export function pagerCanMove(dir: 1 | -1): boolean {
  const panes = document.querySelectorAll(".main .pager-wrap > .pager > .pager-pane");
  if (!panes.length) return false;
  const i = [...panes].findIndex((p) => p.classList.contains("on"));
  return i + dir >= 0 && i + dir < panes.length;
}
