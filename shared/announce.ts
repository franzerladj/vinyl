// Update-Mitteilung an alle, die Mitteilungen eingeschaltet haben (Android und iPhone).
// Bei einem größeren Update `id` hochzählen und den Text anpassen: Der Zeitplan (alle 10 Minuten)
// schickt dann jedem genau einmal Bescheid. `null` = nichts ankündigen.
// Antippen öffnet Crate mit „?update=1“: die App holt dann sofort die neue Version und lädt neu.
export interface Announce {
  id: string;
  title: string;
  body: string;
  url: string;
}

export const ANNOUNCE: Announce | null = {
  id: "2026-11-20",
  title: "Crate hat ein Update",
  body: "Nachrichten an Freunde, Platten zum Leihen anfragen, Werkzeug gleich auf Start, Gut zu wissen. Antippen lädt die neue Version.",
  url: "/?update=1",
};
