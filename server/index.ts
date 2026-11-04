// Lokaler Betrieb unter Node (Entwicklung, Docker, eigener Server).
// Auf Cloudflare läuft stattdessen functions/api/[[path]].ts.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { app as api } from "./app";
import type { Env } from "./env";

// .env minimal einlesen, ohne zusätzliche Abhängigkeit
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn("[crate] SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen. Bitte in .env setzen.");
}

const root = new Hono<{ Bindings: Env }>();
root.route("/", api);
if (process.env.NODE_ENV === "production") {
  root.use("/*", serveStatic({ root: "./web/dist" }));
  root.get("*", async (c) => c.html(await readFile("./web/dist/index.html", "utf8")));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (req) => root.fetch(req, process.env as Env), port }, (i) => console.log(`[crate] läuft auf http://localhost:${i.port}`));
