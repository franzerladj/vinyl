// Konfiguration. Auf Cloudflare kommen die Werte als Bindings (c.env),
// lokal unter Node aus process.env (.env-Datei).
import { memoryKV, type KV, type PushConfig } from "./push";
import { VAPID_PUBLIC_KEY } from "../shared/pushKey";
import { d1Store, memoryStore, type D1Like, type SyncStore } from "./devsync";

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
  LASTFM_API_KEY?: string;
  AI?: AiBinding;
  /** KV-Speicher für Push-Abos (Cloudflare-Binding) */
  PUSH?: KV;
  VAPID_PRIVATE_JWK?: string;
  /** Gemeinsames Geheimnis für den Zeitplan-Worker */
  CRON_SECRET?: string;
  /** D1-Datenbank für den Abgleich zwischen Geräten */
  SYNC?: D1Like;
}

let localKV: KV | null = null;
let localSync: SyncStore | null = null;
/** Abgleich-Speicher: D1 auf Cloudflare, sonst Arbeitsspeicher (lokal, Tests) */
export const syncStore = (env: Env): SyncStore => (env.SYNC ? d1Store(env.SYNC) : (localSync ??= memoryStore()));

export interface Config {
  appUrl: string;
  discogsKey: string;
  discogsSecret: string;
  discogsPersonalToken: string;
  sessionSecret: string;
  lastfmKey: string;
  ai?: AiBinding;
  userAgent: string;
  kv: KV;
  push: PushConfig;
  cronSecret: string;
}

export function readConfig(env: Env, requestUrl: string): Config {
  return {
    appUrl: (env.APP_URL || new URL(requestUrl).origin).replace(/\/$/, ""),
    discogsKey: env.DISCOGS_CONSUMER_KEY ?? "",
    discogsSecret: env.DISCOGS_CONSUMER_SECRET ?? "",
    discogsPersonalToken: env.DISCOGS_PERSONAL_TOKEN ?? "",
    sessionSecret: env.SESSION_SECRET ?? "",
    lastfmKey: env.LASTFM_API_KEY ?? "",
    ai: env.AI,
    userAgent: "CrateDJ/0.2 +https://github.com/franzerladj/vinyl",
    kv: env.PUSH ?? (localKV ??= memoryKV()),
    push: {
      privateJwk: (() => {
        try {
          return env.VAPID_PRIVATE_JWK ? (JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey) : null;
        } catch {
          return null;
        }
      })(),
      publicKey: VAPID_PUBLIC_KEY,
      subject: `${(env.APP_URL || new URL(requestUrl).origin).replace(/\/$/, "")}/impressum`,
    },
    cronSecret: env.CRON_SECRET ?? "",
  };
}
