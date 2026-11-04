// Discogs-Anmeldung vom Gerät aus: Die drei OAuth-Schritte schickt der Browser selbst an Discogs
// (eigene IP, eigenes Limit). Der Server signiert nur. Klappt der direkte Weg nicht, übernimmt der
// Server, und bei Überlastung versucht die App es automatisch noch einmal, ohne dass man neu anfangen muss.

const post = async <T,>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw Object.assign(new Error(j.message ?? `Fehler ${r.status}`), { status: r.status, data: j });
  return j;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Antwort der OAuth-Endpunkte: oauth_token=…&oauth_token_secret=… */
function parseToken(text: string) {
  const p = new URLSearchParams(text);
  const token = p.get("oauth_token");
  const secret = p.get("oauth_token_secret");
  return token && secret ? { token, secret } : null;
}

/** Anmeldung starten. Gibt nur bei endgültigem Fehler zurück, sonst leitet es zu Discogs weiter. */
export async function startLogin(onStatus: (s: string) => void): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { url } = await post<{ url: string }>("/api/auth/start");
      // Ohne eigene Header: einfache Anfrage ohne CORS-Vorabprüfung
      const r = await fetch(url);
      if (r.status === 429) {
        onStatus(`Discogs ist kurz ausgelastet, neuer Versuch in ${3 + attempt * 3} s …`);
        await sleep((3 + attempt * 3) * 1000);
        continue;
      }
      const rt = r.ok ? parseToken(await r.text()) : null;
      if (!rt) break;
      const { authorize } = await post<{ authorize: string }>("/api/auth/pending", rt);
      location.href = authorize;
      return;
    } catch {
      break; // CORS oder Netzwerk: Server-Weg nehmen
    }
  }
  location.href = "/api/auth/login";
}

/** Nach der Rückkehr von Discogs: Access-Token holen und Sitzung anlegen */
export async function completeLogin(token: string, verifier: string, onStatus: (s: string) => void): Promise<{ username: string | null }> {
  let at: { token: string; secret: string } | null = null;

  // 1. Direkt vom Gerät
  for (let attempt = 0; attempt < 3 && !at; attempt++) {
    let res: Response;
    try {
      const { url, body } = await post<{ url: string; body: Record<string, string> }>("/api/auth/sign-access", { token, verifier });
      res = await fetch(url, { method: "POST", body: new URLSearchParams(body) });
    } catch (e) {
      if ((e as { status?: number }).status === 400) throw new Error("Die Anmeldung ist abgelaufen. Bitte noch einmal starten.");
      break; // CORS/Netz: Server übernimmt
    }
    if (res.ok) at = parseToken(await res.text());
    else if (res.status === 429) {
      onStatus("Discogs ist kurz ausgelastet, gleich geht es weiter …");
      await sleep(4000 * (attempt + 1));
    } else break;
  }

  if (at) {
    onStatus("Fast fertig …");
    const done = await post<{ username: string | null }>("/api/auth/finish", at);
    if (done.username) return done;
    return { username: await resolveIdentity() };
  }

  // 2. Rückfall über den Server, mit geduldigen Wiederholungen (der Verifier bleibt gültig)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const done = await post<{ username: string | null }>("/api/auth/exchange", { token, verifier });
      return done.username ? done : { username: await resolveIdentity() };
    } catch (e) {
      const err = e as Error & { status?: number; data?: { busy?: boolean } };
      if (!err.data?.busy) throw new Error(err.status === 400 ? "Die Anmeldung ist abgelaufen. Bitte noch einmal starten." : "Discogs hat die Anmeldung abgelehnt. Bitte noch einmal starten.");
      const wait = 5 + attempt * 5;
      for (let s = wait; s > 0; s--) {
        onStatus(`Discogs ist gerade ausgelastet. Neuer Versuch in ${s} s …`);
        await sleep(1000);
      }
    }
  }
  throw new Error("Discogs ist gerade sehr ausgelastet. Bitte in ein paar Minuten noch einmal anmelden.");
}

/** Benutzernamen direkt bei Discogs abfragen, wenn der Server es gerade nicht konnte */
export async function resolveIdentity(): Promise<string | null> {
  try {
    const s = await post<{ mode: string; url?: string; authorization?: string }>("/api/sign", { method: "GET", path: "/oauth/identity" });
    if (s.mode !== "direct" || !s.url) return null;
    const r = await fetch(s.url, { headers: { Authorization: s.authorization! } });
    if (!r.ok) return null;
    const { username } = (await r.json()) as { username: string };
    await post("/api/auth/identity", { username });
    return username;
  } catch {
    return null;
  }
}
