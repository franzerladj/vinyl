import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = fileURLToPath(new URL(".", import.meta.url));

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  root,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icon.svg", "apple-touch-icon.png", "badge-96.png"],
      manifest: {
        id: "/",
        name: "Crate – Vinyl DJ",
        short_name: "Crate",
        description: "Wantlist, Sammlung, DJ-Sets nach BPM und Key, Einleger und günstige Händler für Vinyl-DJs. Mit Discogs.",
        lang: "de",
        dir: "ltr",
        theme_color: "#16120f",
        background_color: "#16120f",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "portrait",
        scope: "/",
        start_url: "/?source=pwa",
        categories: ["music", "entertainment", "lifestyle"],
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Platte scannen", short_name: "Scannen", url: "/scan", icons: [{ src: "icon-192.png", sizes: "192x192" }] },
          { name: "Wantlist", url: "/wants", icons: [{ src: "icon-192.png", sizes: "192x192" }] },
          { name: "DJ-Sets", url: "/sets", icons: [{ src: "icon-192.png", sizes: "192x192" }] },
          { name: "Shoppen", url: "/shop", icons: [{ src: "icon-192.png", sizes: "192x192" }] },
        ],
      },
      workbox: {
        // Push-Mitteilungen anzeigen und öffnen (web/public/push-sw.js)
        importScripts: ["/push-sw.js"],
        navigateFallbackDenylist: [/^\/api\//, /^\/credits/, /^\/download\//, /^\/\.well-known\//],
        runtimeCaching: [
          {
            // Selbst gehostete Schriften (alle Sprachbereiche, daher nicht vorab gecacht)
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith(".woff2"),
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/i\.discogs\.com\//,
            handler: "CacheFirst",
            options: { cacheName: "covers", expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 180 } },
          },
        ],
      },
    }),
  ],
});
