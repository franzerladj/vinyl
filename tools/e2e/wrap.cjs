// Umbruch-Audit: alle Seiten in 320/375/390 px, hell und dunkel.
// Meldet horizontales Überlaufen, Elemente über den Rand, abgeschnittenen Text ohne Ellipse.
const { chromium, devices } = require("playwright");
const install = require("./mock.cjs");
const ROUTES = ["/", "/collection", "/wants", "/search", "/dig", "/release/5", "/release/9", "/scan", "/shop", "/sets", "/stickers", "/settings",
  "/settings/sync", "/settings/prices", "/settings/sources", "/settings/sheets", "/settings/data", "/settings/about", "/settings/help", "/settings/notifications",
  "/friends", "/friends/kumpel", "/impressum", "/datenschutz"];
const widths = (process.env.W ?? "320,375,390").split(",").map(Number);
const shots = process.env.SHOTS === "1";
(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const scheme of (process.env.SCHEMES ?? "light,dark").split(",")) for (const w of widths) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], viewport: { width: w, height: 760 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => report.push(`${scheme} ${w} JS-Fehler: ${e.message}`));
    await install(page);
    await page.addInitScript(() => { localStorage.setItem("crate:yt", "no"); });
    await page.goto("http://localhost:8787/");
    await page.waitForSelector("text=45 Platten");
    await page.waitForTimeout(scheme === "light" && w === widths[0] ? 30000 : 1500);
    // Ein Set anlegen, damit Set-Seiten Inhalt haben
    for (const r of ROUTES) {
      await page.goto("http://localhost:8787" + r);
      await page.waitForTimeout(r === "/dig" ? 3500 : 1600);
      const issues = await page.evaluate((vw) => {
        const out = [];
        const doc = document.documentElement;
        if (doc.scrollWidth > vw + 1) out.push(`Seite scrollt seitlich (${doc.scrollWidth}px)`);
        const scrollers = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) || s.position === "fixed" && p !== el) { if (/(auto|scroll)/.test(s.overflowX)) return true; } if (/(hidden|clip)/.test(s.overflowX)) return true; } return false; };
        const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} „${(el.textContent || "").trim().slice(0, 40)}“`;
        for (const el of document.querySelectorAll("body *")) {
          const st = getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden" || el.closest(".print-only,.print-area,svg")) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if ((r.right > vw + 1 || r.left < -1) && !scrollers(el)) out.push(`ragt über den Rand: ${label(el)} (${Math.round(r.left)}–${Math.round(r.right)})`);
          // Text abgeschnitten ohne Ellipse
          const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (hasText && el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(st.overflowX) && st.textOverflow !== "ellipsis" && !st.webkitLineClamp?.match?.(/\d/)) out.push(`Text abgeschnitten: ${label(el)}`);
          // Ein einzelnes Wort ragt aus seinem Kasten
          if (hasText && el.scrollWidth > el.clientWidth + 2 && st.overflowX === "visible" && st.whiteSpace !== "nowrap" && el.clientWidth > 0) out.push(`Wort zu lang für Kasten: ${label(el)} (${el.scrollWidth}>${el.clientWidth})`);
        }
        return [...new Set(out)].slice(0, 12);
      }, w);
      for (const i of issues) report.push(`${scheme} ${w} ${r}: ${i}`);
      if (shots && w === widths[0]) await page.screenshot({ path: `${__dirname}/wrap/${scheme}-${w}${r.replace(/\//g, "_") || "_home"}.png`, fullPage: true });
    }
    await ctx.close();
  }
  console.log(report.length ? report.join("\n") : "keine Befunde");
  await b.close();
})();
