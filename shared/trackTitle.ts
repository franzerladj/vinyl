// Tracktitel in Haupttitel und Version zerlegen: „Keep Pushin' (Grant's Bouncing Dub Mix)“
// → „Keep Pushin'“ + „(Grant's Bouncing Dub Mix)“. Nur Klammern am Ende zählen als Version.
export function splitVersion(title: string): { main: string; version: string | null } {
  const m = title.match(/^(.*?\S)\s*((?:[([][^()[\]]+[)\]]\s*)+)$/);
  if (!m) return { main: title, version: null };
  return { main: m[1], version: m[2].trim() };
}
