// API-Zugriff. Alle Discogs-Aufrufe laufen über den eigenen Server (OAuth) und eine Warteschlange,
// die das Discogs-Limit von 60 Anfragen pro Minute einhält.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Job = { run: () => Promise<void>; priority: number };
const queue: Job[] = [];
let running = false;
let remaining = 60;
let lastCall = 0;

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    queue.sort((a, b) => b.priority - a.priority);
    const job = queue.shift()!;
    // Mindestabstand: großzügig, wenn das Kontingent knapp wird
    const gap = remaining > 20 ? 250 : remaining > 5 ? 1100 : 4000;
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
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

export function discogs<T>(path: string, opts: DiscogsOptions = {}): Promise<T> {
  return enqueue(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`/api/discogs${path}`, {
        method: opts.method ?? "GET",
        credentials: "include",
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const rem = res.headers.get("X-Discogs-Ratelimit-Remaining");
      if (rem) remaining = Number(rem);
      if (res.status === 429) {
        remaining = 0;
        await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
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
    throw new ApiError(429, "Discogs-Limit erreicht, bitte kurz warten");
  }, opts.background ? 0 : 10);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const msg = await res.json().then((j: { message?: string }) => j.message ?? res.statusText, () => res.statusText);
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  username: string | null;
  features: { ai: boolean; keyLookup: boolean; oauth: boolean };
  personalToken?: boolean;
}

export const getMe = () => fetch("/api/me", { credentials: "include" }).then((r) => r.json() as Promise<Me>);
export const logout = () => fetch("/api/auth/logout", { method: "POST", credentials: "include" });
