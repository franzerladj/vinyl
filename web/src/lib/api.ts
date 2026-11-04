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

type Job = { run: () => Promise<void>; priority: number };
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
    await job.run();
  }
  running = false;
}

function enqueue<T>(fn: () => Promise<T>, priority: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ priority, run: () => fn().then(resolve, reject) });
    void pump();
  });
}

export interface DiscogsOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Hintergrund-Jobs (Sync) haben niedrige Priorität, Nutzeraktionen hohe */
  background?: boolean;
}

/** Direktweg abschalten, falls der Browser ihn blockiert (z.B. Tracking-Schutz) */
let direct = true;

async function sendDirect(path: string, method: string, body?: string): Promise<Response | null> {
  if (!direct) return null;
  const sig = await fetch("/api/sign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path }),
  });
  if (!sig.ok) return null;
  const s = (await sig.json()) as { mode: "direct" | "proxy"; url?: string; authorization?: string };
  if (s.mode !== "direct" || !s.url || !s.authorization) return null;
  try {
    return await fetch(s.url, {
      method,
      headers: { Authorization: s.authorization, ...(body ? { "Content-Type": "application/json" } : {}) },
      body,
    });
  } catch {
    // Netzwerk- oder CORS-Fehler: ab jetzt über den Server
    direct = false;
    return null;
  }
}

const sendProxy = (path: string, method: string, body?: string) =>
  fetch(`/api/discogs${path}`, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body });

export function discogs<T>(path: string, opts: DiscogsOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  return enqueue(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = (await sendDirect(path, method, body)) ?? (await sendProxy(path, method, body));
      if (res.status === 429) {
        // Fenster als voll markieren und warten
        const t = Date.now();
        while (recent.length < LIMIT_PER_MIN) recent.push(t);
        await new Promise((r) => setTimeout(r, 12_000 * (attempt + 1)));
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
}

export const getMe = () => fetch("/api/me", { credentials: "include" }).then((r) => r.json() as Promise<Me>);
export const logout = () => fetch("/api/auth/logout", { method: "POST", credentials: "include" });

/** Gibt es irgendeine Bilderkennung auf dem Server? */
export const canRecognize = (m: Me | null) => Boolean(m?.features.claude || m?.features.freeAi || ownAnthropicKey());
export const canClaude = (m: Me | null) => Boolean(m?.features.claude || ownAnthropicKey());
