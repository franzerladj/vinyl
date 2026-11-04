// Konfiguration. Auf Cloudflare kommen die Werte als Bindings (c.env),
// lokal unter Node aus process.env (.env-Datei).

/** Minimaler Typ für das Workers-AI-Binding (Cloudflare) */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  APP_URL?: string;
  DISCOGS_CONSUMER_KEY?: string;
  DISCOGS_CONSUMER_SECRET?: string;
  DISCOGS_PERSONAL_TOKEN?: string;
  SESSION_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  /** Discogs-Namen, die den Claude-Key des Betreibers nutzen dürfen (kommagetrennt, "*" = alle) */
  AI_ALLOWLIST?: string;
  GETSONGBPM_API_KEY?: string;
  LASTFM_API_KEY?: string;
  AI?: AiBinding;
}

export interface Config {
  appUrl: string;
  discogsKey: string;
  discogsSecret: string;
  discogsPersonalToken: string;
  sessionSecret: string;
  anthropicKey: string;
  aiAllowlist: string[];
  getSongBpmKey: string;
  lastfmKey: string;
  ai?: AiBinding;
  userAgent: string;
}

export function readConfig(env: Env, requestUrl: string): Config {
  return {
    appUrl: (env.APP_URL || new URL(requestUrl).origin).replace(/\/$/, ""),
    discogsKey: env.DISCOGS_CONSUMER_KEY ?? "",
    discogsSecret: env.DISCOGS_CONSUMER_SECRET ?? "",
    discogsPersonalToken: env.DISCOGS_PERSONAL_TOKEN ?? "",
    sessionSecret: env.SESSION_SECRET ?? "",
    anthropicKey: env.ANTHROPIC_API_KEY ?? "",
    aiAllowlist: (env.AI_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    getSongBpmKey: env.GETSONGBPM_API_KEY ?? "",
    lastfmKey: env.LASTFM_API_KEY ?? "",
    ai: env.AI,
    userAgent: "CrateDJ/0.2 +https://github.com/franzerladj/vinyl",
  };
}
