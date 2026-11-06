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

type Job = { run: () => Promise<void>; fail: (e: Error) => void; priority: number };
const queue: Job[] = [];
let running = false;
let lastCall = 0;
/** Zeitstempel der letzten Anfragen (gleitendes 60-Sekunden-Fenster) */
const recent: number[] = [];
const LIMIT_PER_MIN = 55;

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    queue.sort((a, b) => b.priority - a.priority);
    const job = queue.shift()!;
    const now = Date.now();
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    // Volles Fenster: warten, bis die älteste Anfrage herausfällt
    let wait = recent.length >= LIMIT_PER_MIN ? recent[0] + 60_000 - now : 0;
    // Hintergrund-Jobs gleichmäßig verteilen, Nutzeraktionen sofort
    wait = Math.max(wait, lastCall + (job.priority > 0 ? 150 : 1050) - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    recent.push(lastCall);
    // Wächter: hängt eine Anfrage, läuft die Warteschlange nach spätestens einer Minute weiter
    // Der Aufrufer bekommt dann einen Fehler statt ewig zu warten (sonst hängt z. B. das Einsortieren)
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      job.run(),
      new Promise<void>((r) => (timer = setTimeout(() => (job.fail(new ApiError(408, "Discogs antwortet gerade nicht")), r()), JOB_WATCHDOG_MS))),
    ]);
    clearTimeout(timer);
    // Discogs meldet, wie viele Anfragen in dieser Minute noch gehen: kurz vor null kurz durchatmen
    if (remaining != null && remaining <= 2) {
      const t = Date.now();
      while (recent.length < LIMIT_PER_MIN) recent.push(t);
      remaining = null;
    }
  }
  running = false;
}

const JOB_WATCHDOG_MS = 60_000;
/** Eine einzelne Anfrage darf höchstens so lange dauern, dann wird sie abgebrochen und wiederholt */
const REQUEST_TIMEOUT_MS = 20_000;
let remaining: number | null = null;

/**
 * Die Zeitgrenze gilt bis der Inhalt komplett da ist, nicht nur bis zur Kopfzeile:
 * stockt die Verbindung mitten in der Antwort (WLAN-Wechsel, App im Hintergrund), wird trotzdem abgebrochen.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const body = r.status === 204 || r.status === 304 ? null : await r.arrayBuffer();
    return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
  } finally {
    clearTimeout(t);
  }
}
const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

function enqueue<T>(fn: () => Promise<T>, priority: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ priority, run: () => fn().then(resolve, reject), fail: reject });
    void pump();
  });
}

export interface DiscogsOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Hintergrund-Jobs (Sync) haben niedrige Priorität, Nutzeraktionen hohe */
  background?: boolean;
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
  if (Date.now() < directOffUntil) return null;
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
      directOffUntil = Date.now() + 120_000;
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
        if ((isAbort(e) || (again && e instanceof TypeError)) && attempt < 3 && again) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw isAbort(e) ? new ApiError(408, "Discogs antwortet gerade nicht") : e instanceof TypeError ? new ApiError(0, "Keine Verbindung zu Discogs") : e;
      }
      const left = Number(res.headers.get("X-Discogs-Ratelimit-Remaining"));
      if (Number.isFinite(left) && res.headers.has("X-Discogs-Ratelimit-Remaining")) remaining = left;
      if (res.status === 429) {
        // Fenster als voll markieren und warten
        const t = Date.now();
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
  }, opts.background ? 0 : 10);
}

/** Eigener Anthropic-Key (optional, nur auf diesem Gerät gespeichert) */
export const ownAnthropicKey = () => {
  try {
    return localStorage.getItem("crate_anthropic_key") ?? "";
  } catch {
    return "";
  }
};
export const setOwnAnthropicKey = (k: string) => {
  try {
    if (k) localStorage.setItem("crate_anthropic_key", k);
    else localStorage.removeItem("crate_anthropic_key");
  } catch {
    /* Speicher nicht verfügbar */
  }
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const key = ownAnthropicKey();
  if (key && path.startsWith("/api/ai/")) headers.set("X-Anthropic-Key", key);
  const res = await fetch(path, { credentials: "include", ...init, headers });
  if (!res.ok) {
    const msg = await res.json().then((j: { message?: string }) => j.message ?? res.statusText, () => res.statusText);
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  username: string | null;
  features: {
    oauth: boolean;
    /** Claude nutzbar (Allowlist oder eigener Key) */
    claude: boolean;
    /** Kostenlose KI über Cloudflare Workers AI */
    freeAi: boolean;
    lastfm: boolean;
    keyLookup: boolean;
  };
  personalToken?: boolean;
  /** false: Name noch nicht vom Server bei Discogs bestätigt (wird im Hintergrund nachgeholt) */
  verified?: boolean;
  needIdentity?: boolean;
}

export const getMe = () => fetch("/api/me", { credentials: "include" }).then((r) => r.json() as Promise<Me>);
export const logout = () => fetch("/api/auth/logout", { method: "POST", credentials: "include" });

/** Gibt es irgendeine Bilderkennung auf dem Server? */
export const canRecognize = (m: Me | null) => Boolean(m?.features.claude || m?.features.freeAi || ownAnthropicKey());
export const canClaude = (m: Me | null) => Boolean(m?.features.claude || ownAnthropicKey());
