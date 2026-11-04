// Realistischere Testdaten für den UI-Audit
const ARTISTS = ["Moodymann", "Theo Parrish", "Kerri Chandler", "Larry Heard", "Robert Hood", "DJ Sprinkles", "Phat 'N' Phunky", "Floorplan", "Omar-S", "Mr. Fingers", "Jeff Mills", "Kenny Dope", "Masters At Work", "Joe Claussell", "Ron Trent", "Glenn Underground", "Marcellus Pittman", "Rick Wade", "Delano Smith", "Andrés", "Kai Alcé", "Fred P", "Patrice Scott", "Anthony Nicholson"];
const LABELS = ["KDJ", "Sound Signature", "Madhouse", "Trax", "M-Plant", "Mule Musiq", "Eternal", "Strictly Rhythm", "Nu Groove", "FXHE", "Prescription", "Mahogani Music", "Spiritual Life", "Unirhythm"];
const STYLES = [["Deep House"], ["Deep House", "Soul"], ["Chicago House"], ["Techno"], ["Minimal Techno"], ["House", "Disco"], ["Detroit Techno"], ["Garage House"], ["Afro House"], ["Broken Beat"]];
const COLORS = ["#8a5a2b", "#2b6a8a", "#6a2b8a", "#8a2b3a", "#555", "#3a8a2b", "#c0752a", "#1f3b5c", "#7a6a2b", "#2b8a7a"];
const TITLES = ["Black Mahogani", "Bar A Thym", "Falling Up", "Can You Feel It", "Minimal Nation", "Midtown 120 Blues", "Carwash", "Never Grow Old", "Thirteen Dreams", "Washing Machine", "The Bells", "Get On Down", "I Can't Get No Sleep", "Atmosphere EP", "Altered States", "Chicago Ave", "Pieces", "The Unspoken Language Of Detroit (Extended Edition Including Bonus Remixes)", "Echoes Of The Underground", "Night Shift Vol. 2"];
const img = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c}'/><stop offset='1' stop-color='#111'/></linearGradient></defs><rect width='300' height='300' fill='url(#g)'/><circle cx='150' cy='150' r='70' fill='none' stroke='#fff' stroke-opacity='.25' stroke-width='3'/><circle cx='150' cy='150' r='8' fill='#fff' fill-opacity='.5'/></svg>`)}`;
const R = {};
let n = 0;
for (let id = 1; id <= 100; id++) {
  const a = ARTISTS[id % ARTISTS.length], t = TITLES[(id * 7) % TITLES.length];
  const sides = id === 5 ? ["A", "B", "C", "D"] : id % 9 === 0 ? ["A", "AA"] : ["A", "B"];
  const tracks = [];
  sides.forEach((s, si) => { const k = id === 5 ? 5 : 1 + ((id + si) % 3); for (let j = 1; j <= k; j++) tracks.push({ position: k === 1 ? s : `${s}${j}`, title: j === 1 ? t.split(" (")[0] : `${["Dub", "Instrumental", "Original Mix", "Reprise", "Beats"][j % 5]} ${j === 2 ? "(Long Version)" : ""}`.trim(), duration: `${5 + (id + j) % 4}:${String((id * 13 + j * 7) % 60).padStart(2, "0")}`, type_: "track" }); });
  R[id] = { id, title: t, year: 1986 + (id * 3) % 38, thumb: id % 11 === 0 ? "" : img(COLORS[id % COLORS.length]), cover_image: id % 11 === 0 ? "" : img(COLORS[id % COLORS.length]),
    artists: [{ name: a }], labels: [{ name: LABELS[id % LABELS.length], catno: `${LABELS[id % LABELS.length].slice(0, 3).toUpperCase()}${100 + id}` }],
    formats: [{ name: "Vinyl", qty: "1", descriptions: ["12\"", id % 2 ? "33 ⅓ RPM" : "45 RPM"] }], genres: ["Electronic"], styles: STYLES[id % STYLES.length], country: ["US", "UK", "Germany", "Japan"][id % 4], uri: "",
    tracklist: tracks, videos: [{ uri: `https://www.youtube.com/watch?v=${String(id).padStart(11, "x")}`, title: `${a} - ${t}`, duration: 360 }], community: { have: 100 + id * 37, want: 200 + ((id * 97) % 900) } };
}
const basic = (r) => ({ id: r.id, title: r.title, year: r.year, thumb: r.thumb, cover_image: r.cover_image, artists: r.artists, labels: r.labels, formats: r.formats, genres: r.genres, styles: r.styles });
const COLL = Array.from({ length: 45 }, (_, i) => i + 1);
const WANTS = Array.from({ length: 25 }, (_, i) => i + 46);
module.exports = async function install(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/discogs/users/franzerladj") return json({ username: "franzerladj", name: "Franz Kralik", location: "Bayreuth", avatar_url: "https://i.pravatar.cc/200?img=33" });
    if (p === "/api/me") return json({ username: "franzerladj", features: { claude: false, freeAi: true, lastfm: true, keyLookup: false, oauth: true } });
    if (p === "/api/sign") return json({ mode: "proxy" });
    const um = p.match(/\/users\/([^/]+)(\/.*)?$/);
    if (um && um[1] !== "franzerladj") {
      const u = decodeURIComponent(um[1]);
      if (u === "niemand") return json({ message: "User does not exist or may have been deleted." }, 404);
      if (!um[2]) return json({ username: u, name: u === "kumpel" ? "Max Kumpel" : "", location: "Bayreuth", avatar_url: u === "kumpel" ? "https://i.pravatar.cc/200?img=12" : "", num_collection: u === "privat" ? null : 30 });
      if (u === "privat") return json({ message: "You are not allowed to view this resource. Please authenticate as the owner to view this content." }, 403);
      if (um[2].includes("/collection/")) { const ids = [...WANTS.slice(0, 6), ...COLL.slice(0, 20)]; return json({ pagination: { page: 1, pages: 1, per_page: 100, items: ids.length }, releases: ids.map((id) => ({ id, date_added: "2026-01-01T00:00:00", basic_information: basic(R[id]) })) }); }
      if (um[2].includes("/wants")) { const ids = [...COLL.slice(30, 34), 70]; return json({ pagination: { page: 1, pages: 1, per_page: 100, items: ids.length }, wants: ids.map((id) => ({ id, date_added: "2026-01-01T00:00:00", basic_information: basic(R[id]) })) }); }
    }
    if (p.includes("/collection/folders/0/releases")) return json({ pagination: { page: 1, pages: 1, per_page: 100, items: COLL.length }, releases: COLL.map((id) => ({ id, instance_id: 1000 + id, folder_id: 1, date_added: new Date(Date.UTC(2026, 10, 3) - id * 86400000 * 3).toISOString(), rating: id % 6, basic_information: basic(R[id]) })) });
    if (p.endsWith("/wants")) return json({ pagination: { page: 1, pages: 1, per_page: 100, items: WANTS.length }, wants: WANTS.map((id) => ({ id, date_added: new Date(Date.UTC(2026, 10, 1) - id * 86400000).toISOString(), rating: id % 4, basic_information: basic(R[id]) })) });
    let m = p.match(/\/releases\/(\d+)$/); if (m) return json(R[m[1]]);
    m = p.match(/marketplace\/price_suggestions\/(\d+)/); if (m) return json({ message: "You must fill out your seller settings first." }, 422);
    m = p.match(/marketplace\/stats\/(\d+)/); if (m) { const id = +m[1]; return json({ lowest_price: id % 7 === 0 ? null : { value: 6 + (id * 17) % 60, currency: "EUR" }, num_for_sale: id % 7 === 0 ? 0 : (id * 5) % 40 }); }
    if (p === "/api/audio/lookup") { const t = url.searchParams.get("title") || ""; const h = [...t].reduce((a, c) => a + c.charCodeAt(0), 0); return json({ bpm: h % 4 === 0 ? null : 112 + (h % 22), key: h % 3 === 0 ? null : ["Am", "Dm", "Em", "C", "F#m", "Gm", "Bbm", "Eb"][h % 8], source: ["Test"], previewUrl: null }); }
    if (p === "/api/lastfm/tags") return json({ source: "track", tags: [{ name: "deep", count: 100 }, { name: "groovy", count: 70 }] });
    if (p === "/api/audio/preview") return route.fulfill({ status: 404, body: "" });
    if (p.includes("/database/search") && /[?&](style|label|artist)=/.test(url.search)) {
      const ids = Array.from({ length: 30 }, (_, i) => 71 + i).sort(() => Math.random() - 0.5).slice(0, 15);
      return json({ pagination: { page: 1, pages: 1, per_page: 30, items: 15 }, results: ids.map((id) => ({ id, type: "release", title: `${R[id].artists[0].name} - ${R[id].title}`, thumb: R[id].thumb || img("#555"), cover_image: R[id].thumb || img("#555"), year: String(R[id].year), label: [R[id].labels[0].name], catno: R[id].labels[0].catno, style: R[id].styles, country: R[id].country, format: ["Vinyl"], community: { have: 10 + id, want: 80 + id * 3 } })) });
    }
    if (p.includes("/database/search")) return json({ pagination: { page: 1, pages: 3, per_page: 40, items: 120 }, results: WANTS.slice(0, 12).map((id) => ({ id, type: "release", title: `${R[id].artists[0].name} - ${R[id].title}`, thumb: R[id].thumb, cover_image: R[id].thumb, year: String(R[id].year), label: [R[id].labels[0].name], catno: R[id].labels[0].catno, style: R[id].styles, country: R[id].country, format: ["Vinyl", "12\""], community: { have: 10, want: 30 } })) });
    return json({});
  });
};
