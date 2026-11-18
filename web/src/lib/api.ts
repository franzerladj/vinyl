// API-Zugriff auf Discogs.
// Discogs drosselt pro IP-Adresse (60 Anfragen/Minute). Deshalb schickt der Browser die
// Anfragen selbst an api.discogs.com, von der eigenen IP. Der Server liefert nur die
// OAuth-Signatur für genau diese Anfrage. Klappt das nicht, geht es über den Server-Proxy.
// Eine Warteschlange hält das Limit ein und bevorzugt Nutzeraktionen vor Hintergrund-Sync.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Job = { run: () => Promise<void>; fail: (e: Error) => void; priority: number; path?: string };
const queue: Job[] = [];
/** Zeitstempel der letzten Anfragen (gleitendes 60-Sekunden-Fenster) */
const recent: number[] = [];
const LIMIT_PER_MIN = 58;
/** So viele davon darf der Hintergrund nehmen (der Rest bleibt frei für das, was du antippst) */
const BACKGROUND_PER_MIN = 44;
/** … und so viele, solange du selbst etwas lädst */
const BACKGROUND_PER_MIN_BUSY = 14;
// Mehrere Anfragen gleichzeitig: ein kleiner Abgleich ist so in Sekunden durch statt in einer Minute.
// Der Hintergrund nimmt höchstens drei Plätze, damit für das, was du antippst, immer einer frei ist.
const MAX_PARALLEL = 4;
const MAX_BACKGROUND = 3;
// Der Hintergrund bekommt einen Vorrat für den schnellen Start und danach einen gleichmäßigen Takt.
// Vorher durfte er das ganze Minuten-Kontingent in den ersten Sekunden verbrauchen: dann stand alles,
// was man antippte (Diggen, Platten-Seite), bis zu 48 Sekunden. So wird ständig wieder etwas frei.
// Ist man gerade selbst unterwegs (Anfrage in den letzten 20 s), tritt der Hintergrund deutlich kürzer.
const BG_BURST = 14;
const BG_EVERY_MS = 1300;
const BG_EVERY_BUSY_MS = 4000;
const USER_ACTIVE_MS = 20_000;
let bgTokens = BG_BURST;
let bgRefillAt = 0;
let lastUserAt = -Infinity;
let active = 0;
let activeBackground = 0;
let lastCall = -Infinity;
let wake: ReturnType<typeof setTimeout> | null = null;
let wakeAt = 0;
let pausedUntil = 0;
/** Wie lange die Schlange noch wartet, weil Discogs für diese Minute genug hat (ms, 0 = läuft) */
export const discogsPauseMs = () => (queue.length ? Math.max(0, pausedUntil - clock()) : 0);
// Gleichmäßig laufende Uhr statt Systemzeit: stellt jemand die Uhr zurück (Zeitzone, Zeitabgleich),
// würde die Schlange sonst so lange stehen, bis die alte Zeit wieder erreicht ist
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function pump() {
  while (queue.length && active < MAX_PARALLEL) {
    queue.sort((a, b) => b.priority - a.priority);
    const job = queue[0];
    const bg = job.priority <= 0;
    // Vorn steht ein Hintergrund-Job (also wartet nichts Angetipptes) und seine Plätze sind belegt
    if (bg && activeBackground >= MAX_BACKGROUND) return;
    const now = clock();
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    // Volles Fenster: warten, bis die älteste Anfrage herausfällt.
    // Hintergrund-Jobs lassen Anfragen frei: was du antippst, kommt auch bei laufendem Sync sofort dran
    // Bist du gerade selbst unterwegs (z. B. beim Diggen), bekommt der Hintergrund nur einen kleinen Teil der
    // Minute: jede Karte braucht eine Anfrage, und die soll nicht hinter dem Abgleich warten.
    // Vorgeladenes (nächste Karte) lässt die letzten Plätze frei für das, was du gerade ansiehst.
    const userActive = now - lastUserAt < USER_ACTIVE_MS;
    const cap = bg ? (userActive ? BACKGROUND_PER_MIN_BUSY : BACKGROUND_PER_MIN) : job.priority < 10 ? LIMIT_PER_MIN - 6 : LIMIT_PER_MIN;
    let wait = recent.length >= cap ? recent[recent.length - cap] + 60_000 - now : 0;
    // Als Pause von Discogs gilt nur das volle Fenster, nicht das Zurückstehen hinter dir
    pausedUntil = wait > 0 && !(bg && userActive) ? now + wait : 0;
    if (bg) {
      // Vorrat auffüllen: im Takt, langsamer solange du selbst etwas lädst
      const every = userActive ? BG_EVERY_BUSY_MS : BG_EVERY_MS;
      if (!bgRefillAt) bgRefillAt = now;
      const add = Math.floor((now - bgRefillAt) / every);
      if (add > 0) {
        bgTokens = Math.min(BG_BURST, bgTokens + add);
        bgRefillAt = bgTokens >= BG_BURST ? now : bgRefillAt + add * every;
      }
      if (bgTokens < 1) wait = Math.max(wait, bgRefillAt + every - now);
    }
    // Kurzer Abstand, damit nicht alles im selben Augenblick losgeht
    wait = Math.max(wait, lastCall + (bg ? 220 : 60) - now);
    if (wait > 0) {
      // Läuft schon ein Wecker für später (z. B. der lange eines Hintergrund-Jobs), wird er vorgezogen.
      // Sonst wartet etwas Angetipptes, das nur den kurzen Abstand braucht, bis zu 50 s auf den alten Wecker.
      if (wake && wakeAt > now + wait + 5) {
        clearTimeout(wake);
        wake = null;
      }
      if (!wake) {
        wakeAt = now + wait;
        wake = setTimeout(() => {
          wake = null;
          // Der Abstand ist abgewartet, egal was die Uhr sagt
          lastCall = -Infinity;
          pump();
        }, wait);
      }
      return;
    }
    queue.shift();
    lastCall = now;
    recent.push(now);
    active++;
    if (bg) {
      activeBackground++;
      if (bgTokens >= BG_BURST) bgRefillAt = now;
      bgTokens--;
    } else if (job.priority >= 10) lastUserAt = now;
    // Wächter: hängt eine Anfrage, wird ihr Platz nach spätestens einer Minute frei.
    // Der Aufrufer bekommt dann einen Fehler statt ewig zu warten (sonst hängt z. B. das Einsortieren)
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      job.run(),
      new Promise<void>((r) => (timer = setTimeout(() => (job.fail(new ApiError(408, "Discogs antwortet gerade nicht")), r()), JOB_WATCHDOG_MS))),
    ]).finally(() => {
      clearTimeout(timer);
      active--;
      if (bg) activeBackground--;
      // Discogs meldet, wie viele Anfragen in dieser Minute noch gehen: kurz vor null durchatmen
      if (remaining != null && remaining <= 3) {
        const t = clock();
        while (recent.length < LIMIT_PER_MIN) recent.push(t);
        remaining = null;
      }
      pump();
    });
  }
}

const JOB_WATCHDOG_MS = 60_000;
/** Eine einzelne Anfrage darf höchstens so lange dauern, dann wird sie abgebrochen und wiederholt */
const REQUEST_TIMEOUT_MS = 20_000;
let remaining: number | null = null;

/**
 * Die Zeitgrenze gilt bis der Inhalt komplett da ist, nicht nur bis zur Kopfzeile:
 * stockt die Verbindung mitten in der Antwort (WLAN-Wechsel, App im Hintergrund), wird trotzdem abgebrochen.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const body = r.status === 204 || r.status === 304 ? null : await r.arrayBuffer();
    return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
  } finally {
    clearTimeout(t);
  }
}
const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function enqueue<T>(fn: () => Promise<T>, priority: number, path?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ priority, path, run: () => fn().then(resolve, reject), fail: reject });
    pump();
  });
}

/** Etwas Vorgeladenes wird jetzt gebraucht (die Karte ist dran): in der Schlange nach vorn */
export function hurryDiscogs(pathStart: string) {
  let any = false;
  for (const j of queue)
    if (j.priority < 10 && j.path?.startsWith(pathStart)) {
      j.priority = 10;
      any = true;
    }
  if (any) pump();
}

export interface DiscogsOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Hintergrund-Jobs (Sync) haben niedrige Priorität, Nutzeraktionen hohe */
  background?: boolean;
  /** Vorladen (z. B. die nächste Karte beim Diggen): nach dem Angetippten, aber vor dem Abgleich */
  soon?: boolean;
  /** Schreibende Anfrage, die man gefahrlos wiederholen kann (z. B. in einen Ordner verschieben) */
  retry?: boolean;
}

/**
 * Direktweg nur dann abschalten, wenn der Browser ihn wirklich blockiert (z. B. Tracking-Schutz):
 * erst nach drei Fehlschlägen am Stück und nur für zwei Minuten. Ein einzelner Netz-Aussetzer
 * (WLAN-Wechsel, App kurz im Hintergrund) soll nicht dauerhaft auf den gebremsten Server-Weg zwingen.
 */
let directFails = 0;
let directOffUntil = 0;

async function sendDirect(path: string, method: string, body?: string): Promise<Response | null> {
  if (clock() < directOffUntil) return null;
  const sig = await fetchWithTimeout("/api/sign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path }),
  });
  if (!sig.ok) return null;
  const s = (await sig.json()) as { mode: "direct" | "proxy"; url?: string; authorization?: string };
  if (s.mode !== "direct" || !s.url || !s.authorization) return null;
  try {
    const r = await fetchWithTimeout(s.url, {
      method,
      headers: { Authorization: s.authorization, ...(body ? { "Content-Type": "application/json" } : {}) },
      body,
    });
    directFails = 0;
    return r;
  } catch (e) {
    // Zeitüberschreitung: einfach nochmal versuchen (der Aufrufer wiederholt), nicht abschalten
    if (isAbort(e)) throw e;
    if (++directFails >= 3) {
      directOffUntil = clock() + 120_000;
      directFails = 0;
    }
    return null;
  }
}

const sendProxy = (path: string, method: string, body?: string) =>
  fetchWithTimeout(`/api/discogs${path}`, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body });

export function discogs<T>(path: string, opts: DiscogsOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  return enqueue(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response;
      try {
        res = (await sendDirect(path, method, body)) ?? (await sendProxy(path, method, body));
      } catch (e) {
        // Hängende Anfrage abgebrochen: kurz warten und neu versuchen
        const again = method === "GET" || opts.retry;
        // Ohne Netz bringt Wiederholen nichts: sofort melden statt mehrere Sekunden zu warten
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (!offline && (isAbort(e) || (again && e instanceof TypeError)) && attempt < 3 && again) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw isAbort(e) ? new ApiError(408, "Discogs antwortet gerade nicht") : e instanceof TypeError ? new ApiError(0, "Keine Verbindung zu Discogs") : e;
      }
      const left = Number(res.headers.get("X-Discogs-Ratelimit-Remaining"));
      if (Number.isFinite(left) && res.headers.has("X-Discogs-Ratelimit-Remaining")) remaining = left;
      if (res.status === 429) {
        // Fenster als voll markieren und warten
        const t = clock();
        while (recent.length < LIMIT_PER_MIN) recent.push(t);
        await new Promise((r) => setTimeout(r, Math.min(30_000, 8_000 * (attempt + 1))));
        continue;
      }
      if (!res.ok) {
        const msg = await res.json().then((j: { message?: string }) => j.message ?? res.statusText, () => res.statusText);
        throw new ApiError(res.status, msg);
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    throw new ApiError(429, "Discogs ist gerade ausgelastet, bitte kurz warten");
  }, opts.background ? 0 : opts.soon ? 5 : 10, path);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Zeitlimit bis der Inhalt da ist: eine hängende Verbindung hielte sonst den ganzen Durchlauf (Tempo-Suche) für immer an
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(path, { credentials: "include", signal: ac.signal, ...init, headers });
    if (!res.ok) {
      const msg = await res.json().then((j: { message?: string }) => j.message ?? res.statusText, () => res.statusText);
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as T;
  } catch (e) {
    throw isAbort(e) && !init?.signal?.aborted ? new ApiError(408, "Der Server antwortet gerade nicht") : e;
  } finally {
    clearTimeout(timer);
  }
}
const API_TIMEOUT_MS = 45_000;

export interface Me {
  username: string | null;
  features: {
    oauth: boolean;
    /** Kostenlose KI über Cloudflare Workers AI */
    freeAi: boolean;
    lastfm: boolean;
  };
  personalToken?: boolean;
  /** false: Name noch nicht vom Server bei Discogs bestätigt (wird im Hintergrund nachgeholt) */
  verified?: boolean;
  needIdentity?: boolean;
}

export const getMe = () => fetch("/api/me", { credentials: "include" }).then((r) => r.json() as Promise<Me>);
export const logout = () => fetch("/api/auth/logout", { method: "POST", credentials: "include" });
/** Alle anderen Geräte abmelden (dieses bleibt angemeldet) */
export const revokeOtherSessions = () => api<{ ok: boolean }>("/api/auth/revoke-others", { method: "POST" });

/** Gibt es irgendeine Bilderkennung auf dem Server? */
export const canRecognize = (m: Me | null) => Boolean(m?.features.freeAi);
