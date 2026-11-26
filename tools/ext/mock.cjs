// Nachgestellter Server für den Test der Erweiterung: spielt Crate (/api/…), die Discogs-Schnittstelle (/dapi/…),
// eine Discogs-Plattenseite (/release/…) und einen Plattenladen (/shop). Merkt sich, was die Erweiterung schickt.
const http = require("http");
const PORT = Number(process.env.PORT || 8799);
const B = `http://localhost:${PORT}`;
const state = { wants: new Set([46, 47]), calls: [], sign: [], unread: 2, dm: 1, requests: 1 };
const REL = {
  3: { title: "Bar A Thym", artists: [{ name: "Larry Heard (2)" }], year: 1995, labels: [{ name: "Trax", catno: "TRA103" }] },
  46: { title: "Falling Up", artists: [{ name: "Patrice Scott" }], year: 2009, labels: [{ name: "Sistrum", catno: "SIS046" }] },
  71: { title: "The Bells", artists: [{ name: "Delano Smith" }], year: 1990, labels: [{ name: "Eternal", catno: "ETE190" }] },
};
const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const page = (res, title, body) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;margin:40px;max-width:720px;line-height:1.5}</style></head><body>${body}</body></html>`);
};
const read = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, B);
    const p = u.pathname;
    const signedIn = /crate_session=ok/.test(req.headers.cookie || "");
    if (p === "/login") {
      res.writeHead(200, { "Set-Cookie": "crate_session=ok; Path=/; HttpOnly; SameSite=Lax", "Content-Type": "text/html; charset=utf-8" });
      return res.end("<!doctype html><title>Crate</title><p>angemeldet</p>");
    }
    if (p === "/logout") {
      res.writeHead(200, { "Set-Cookie": "crate_session=; Path=/; Max-Age=0", "Content-Type": "text/html" });
      return res.end("<!doctype html><title>Crate</title><p>abgemeldet</p>");
    }
    if (p === "/state") return json(res, { wants: [...state.wants], calls: state.calls, sign: state.sign });
    // ---- Crate ----
    if (p === "/api/me") return json(res, signedIn ? { username: "franzerladj", verified: true } : { features: {} });
    if (p === "/api/sign") {
      const b = JSON.parse((await read(req)) || "{}");
      state.sign.push({ origin: req.headers.origin ?? null, site: req.headers["sec-fetch-site"] ?? null, cookie: signedIn, path: b.path });
      if (!signedIn) return json(res, { mode: "proxy" });
      return json(res, { mode: "direct", url: `${B}/dapi${b.path}`, authorization: "OAuth test" });
    }
    if (p.startsWith("/api/discogs/")) return json(res, { message: "nicht angemeldet" }, 401);
    if (p === "/api/buzz") return signedIn ? json(res, { unread: state.unread, dm: state.dm, inbox: [] }) : json(res, {}, 401);
    if (p === "/api/friends") return signedIn ? json(res, { friends: ["kumpel"], in: Array.from({ length: state.requests }, () => ({ from: "kumpel", at: 1 })), out: [] }) : json(res, {}, 401);
    if (p.startsWith("/api/ext/release/")) {
      if (!signedIn) return json(res, {}, 401);
      const id = Number(p.split("/").pop());
      return json(res, id === 3
        ? { sync: true, tracks: [{ position: "A1", title: "Bar A Thym", bpm: 124, key: "9A" }, { position: "A2", title: "Bar A Thym (Long Version)", bpm: 124.2, key: "9A" }, { position: "B1", title: "Reprise", bpm: 116, key: null }], sets: [{ name: "Freitag im Klubraum", date: "2026-11-13", played: true }], shelf: "Regal 2" }
        : { sync: true, tracks: [], sets: [] });
    }
    // ---- Discogs-Schnittstelle ----
    if (p.startsWith("/dapi/")) {
      if (req.headers.authorization !== "OAuth test") return json(res, { message: "auth" }, 401);
      const d = p.slice(5);
      state.calls.push(`${req.method} ${d}${u.search}`);
      let m;
      if ((m = /^\/users\/[^/]+\/collection\/releases\/(\d+)$/.exec(d)))
        return json(res, { releases: m[1] === "3" ? [{ instance_id: 1, folder_id: 5, date_added: "2024-03-12T10:00:00-07:00", notes: [{ field_id: 1, value: "Very Good Plus (VG+)" }, { field_id: 2, value: "Very Good (VG)" }, { field_id: 3, value: "Gute Pressung [Ordner: Sommer] [Bezahlt: 18 €]" }] }] : [] });
      if (/^\/users\/[^/]+\/collection\/folders$/.test(d)) return json(res, { folders: [{ id: 0, name: "All" }, { id: 1, name: "Uncategorized" }, { id: 5, name: "Auflegen" }] });
      if (/^\/users\/[^/]+\/wants$/.test(d)) return json(res, { pagination: { page: 1, pages: 1 }, wants: [...state.wants].map((id) => ({ id })) });
      if ((m = /^\/users\/[^/]+\/wants\/(\d+)$/.exec(d))) {
        if (req.method === "PUT") state.wants.add(Number(m[1]));
        if (req.method === "DELETE") state.wants.delete(Number(m[1]));
        res.writeHead(req.method === "PUT" ? 201 : 204, { "Content-Type": "application/json" });
        return res.end(req.method === "PUT" ? "{}" : "");
      }
      if ((m = /^\/releases\/(\d+)$/.exec(d))) return REL[m[1]] ? json(res, { id: Number(m[1]), ...REL[m[1]], thumb: "" }) : json(res, {}, 404);
      if (/^\/marketplace\/stats\/\d+$/.test(d)) return json(res, { lowest_price: { value: 7.5, currency: "EUR" }, num_for_sale: 9 });
      if (d === "/database/search") {
        const q = (u.searchParams.get("q") || "").toLowerCase();
        const all = Object.entries(REL).map(([id, r]) => ({ id: Number(id), title: `${r.artists[0].name.replace(/\s\(\d+\)$/, "")} - ${r.title}`, year: String(r.year), label: [r.labels[0].name], catno: r.labels[0].catno, format: ["Vinyl", '12"'], country: "US", thumb: "", user_data: { in_collection: id === "3", in_wantlist: state.wants.has(Number(id)) } }));
        return json(res, { results: q.includes("nichts") ? [] : all.filter((r) => q.length < 3 || r.title.toLowerCase().includes(q) || r.catno.toLowerCase() === q || q.split(" ").some((w) => w.length > 2 && r.title.toLowerCase().includes(w))) });
      }
      return json(res, {}, 404);
    }
    // ---- Seiten ----
    if (/\/release\/\d+/.test(p)) return page(res, "Discogs (nachgestellt)", `<h1>Plattenseite</h1><p>Hier stünde die Seite von Discogs. Die Erweiterung liest davon nichts, nur die Nummer in der Adresse.</p><p><a href="/release/46-Patrice-Scott-Falling-Up">andere Platte</a></p>`);
    if (p === "/shop") return page(res, "Plattenladen", `<h1>Neu im Laden</h1><p id="pick">Delano Smith The Bells</p><p>ETE190 · 12" · 14,90 €</p>`);
    return page(res, "Leer", "<p>leer</p>");
  })
  .listen(PORT, () => console.log(`mock ${B}`));
