// Zentrale Konfiguration aus Umgebungsvariablen (siehe .env.example)
import { readFileSync, existsSync } from "node:fs";

// .env minimal einlesen, ohne zusätzliche Abhängigkeit
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  discogsKey: process.env.DISCOGS_CONSUMER_KEY ?? "",
  discogsSecret: process.env.DISCOGS_CONSUMER_SECRET ?? "",
  // Optional: persönlicher Token für Single-User-Betrieb ohne OAuth
  discogsPersonalToken: process.env.DISCOGS_PERSONAL_TOKEN ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  getSongBpmKey: process.env.GETSONGBPM_API_KEY ?? "",
  userAgent: "CrateDJ/0.1 +https://github.com/franzerladj/vinyl",
};

if (!config.sessionSecret || config.sessionSecret.length < 32) {
  console.warn("[crate] SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen. Bitte in .env setzen.");
}
