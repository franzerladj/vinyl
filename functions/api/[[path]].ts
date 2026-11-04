// Cloudflare Pages Function: alle Anfragen unter /api/* gehen an die Hono-App.
import { handle } from "hono/cloudflare-pages";
import { app } from "../../server/app";

export const onRequest = handle(app);
