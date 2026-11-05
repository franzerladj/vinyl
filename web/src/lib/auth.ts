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
    // Der Server bestätigt den Namen selbst bei Discogs. Ist Discogs ausgelastet, geduldig wiederholen.
    for (let attempt = 0; attempt < 8; attempt++) {
      onStatus(attempt ? onStatusWait(attempt) : "Fast fertig …");
      try {
        return await post<{ username: string | null }>("/api/auth/finish", at);
      } catch (e) {
        const err = e as Error & { data?: { busy?: boolean } };
        if (!err.data?.busy) throw new Error("Discogs hat die Anmeldung abgelehnt. Bitte noch einmal starten.");
        for (let s = 4 + attempt * 3; s > 0; s--) {
          onStatus(`Discogs ist gerade ausgelastet. Neuer Versuch in ${s} s …`);
          await sleep(1000);
        }
      }
    }
    throw new Error("Discogs ist gerade sehr ausgelastet. Bitte in ein paar Minuten noch einmal anmelden.");
  }

  // 2. Rückfall über den Server, mit geduldigen Wiederholungen (der Verifier bleibt gültig)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const done = await post<{ username: string | null }>("/api/auth/exchange", { token, verifier });
      // Ohne bestätigten Namen geht es trotzdem weiter, die App holt ihn im Hintergrund nach
      return done;
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

const onStatusWait = (n: number) => `Noch einen Moment (Versuch ${n + 1}) …`;

/** Ältere Sitzung ohne bestätigten Namen: der Server fragt Discogs (mit Wiederholungen) */
export async function resolveIdentity(): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return (await post<{ username: string }>("/api/auth/identity", {})).username;
    } catch (e) {
      if (!(e as { data?: { busy?: boolean } }).data?.busy) return null;
      await sleep(3000 * (attempt + 1));
    }
  }
  return null;
}

/**
 * Unbestätigte Sitzung: Den Namen fragt das Gerät selbst bei Discogs (eigene IP, kaum gebremst)
 * und meldet ihn vorläufig an. Der Server bestätigt ihn später.
 */
export async function claimIdentity(): Promise<string | null> {
  try {
    const { discogs } = await import("./api");
    const me = await discogs<{ username: string }>("/oauth/identity");
    if (!me?.username) return null;
    await post("/api/auth/claim", { username: me.username });
    return me.username;
  } catch {
    return null;
  }
}

let verifying = false;
/** Im Hintergrund geduldig bestätigen lassen: alle paar Minuten, bis der Server Discogs erreicht */
export function verifyInBackground(onVerified: (name: string) => void) {
  if (verifying) return;
  verifying = true;
  void (async () => {
    for (let i = 0; i < 20; i++) {
      await sleep(i === 0 ? 5000 : Math.min(10 * 60_000, 60_000 * (i + 1)));
      try {
        const r = await post<{ username: string; verified?: boolean }>("/api/auth/identity", {});
        if (r.username) {
          onVerified(r.username);
          break;
        }
      } catch (e) {
        // 401: Zugang ungültig, dann hilft nur neu anmelden; sonst weiter warten
        if ((e as { status?: number }).status === 401) break;
      }
    }
    verifying = false;
  })();
}
