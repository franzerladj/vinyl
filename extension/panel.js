// Gemeinsame Bausteine für alles, was die Erweiterung auf Seiten zeigt (Feld auf Discogs, Einblendung nach
// Rechtsklick) und für das Suchfenster. Kein Framework: wenige Elemente, alles über textContent (Namen und Titel
// kommen von Discogs und werden nie als HTML eingesetzt).
(() => {
  if (globalThis.__crate) return;

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r ?? { ok: false, error: chrome.runtime.lastError?.message ?? "Keine Antwort" }));
      } catch (e) {
        // Erweiterung wurde neu geladen, die Seite hat noch das alte Skript
        resolve({ ok: false, error: "Crate wurde aktualisiert. Seite neu laden." });
      }
    });

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .c { --bg: #0b0b0b; --surface: #1c1c1c; --surface-2: #262626; --line: rgba(255,255,255,.09); --text: #f5f5f4; --text-2: rgba(245,245,244,.62); --text-3: rgba(245,245,244,.36); --lime: #c6ff3a; --ink: #0b0b0b; --bad: #ff5a47;
      font: 400 14px/1.4 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); -webkit-font-smoothing: antialiased; text-align: left; }
    .card { background: var(--bg); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 18px 50px -12px rgba(0,0,0,.6); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; }
    .mark { width: 22px; height: 22px; border-radius: 6px; flex: none; }
    .word { font: 900 17px/1 "Crate Archivo", system-ui, sans-serif; font-stretch: 125%; font-variation-settings: "wdth" 125; letter-spacing: -.035em; flex: 1; }
    .ic { all: unset; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: var(--text-2); }
    .ic:hover { background: var(--surface-2); color: var(--text); }
    .ic:focus-visible, .btn:focus-visible, .row:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; }
    .ic svg { width: 16px; height: 16px; }
    .body { padding: 0 14px 14px; display: grid; gap: 12px; }
    .verdict { padding: 12px 14px; border-radius: 12px; font: 900 22px/1 "Crate Archivo", system-ui, sans-serif; font-stretch: 62%; font-variation-settings: "wdth" 62; text-transform: uppercase; letter-spacing: .01em; }
    .verdict.have { background: var(--lime); color: var(--ink); }
    .verdict.want { background: var(--surface-2); color: var(--lime); }
    .verdict.new { background: var(--surface); color: var(--text); }
    .verdict small { display: block; margin-top: 5px; font: 500 12.5px/1.3 "Inter", system-ui, sans-serif; font-stretch: normal; font-variation-settings: normal; text-transform: none; letter-spacing: 0; opacity: .8; }
    .facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 12px; font-size: 13px; }
    .facts dt { color: var(--text-3); }
    .facts dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
    .data { font: 600 12px/1.2 "Crate Archivo", system-ui, sans-serif; font-stretch: 112%; font-variation-settings: "wdth" 112; font-variant-numeric: tabular-nums; }
    .tracks { display: grid; gap: 1px; border-radius: 12px; overflow: hidden; background: var(--line); }
    .tr { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; gap: 8px; align-items: baseline; padding: 7px 10px; background: var(--surface); font-size: 13px; }
    .tr .pos { color: var(--text-3); }
    .tr .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tr .bpm { color: var(--text); }
    .tr .key { min-width: 26px; padding: 2px 5px; border-radius: 5px; background: var(--surface-2); color: var(--lime); text-align: center; }
    .note { margin: 0; font-size: 12.5px; color: var(--text-2); }
    .note b { color: var(--text); font-weight: 600; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px; border-radius: 999px; background: var(--surface-2); color: var(--text); font: 600 13.5px/1 "Inter", system-ui, sans-serif; cursor: pointer; white-space: nowrap; text-decoration: none; }
    .btn:hover { background: #333; }
    .btn.primary { background: var(--lime); color: var(--ink); }
    .btn.primary:hover { background: #d8ff6e; }
    .btn[disabled] { opacity: .5; cursor: default; }
    .credit { font-size: 11px; color: var(--text-3); }
    .credit a { color: inherit; }
    .list { display: grid; gap: 1px; background: var(--line); border-radius: 12px; overflow: hidden; }
    .row { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: center; padding: 9px 10px; background: var(--surface); }
    .row img, .ph { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--surface-2); display: block; }
    .row .ti { font-weight: 600; font-size: 13.5px; line-height: 1.25; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .row .sub { font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .chip { padding: 3px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: var(--surface-2); color: var(--text-2); white-space: nowrap; }
    .chip.have { background: var(--lime); color: var(--ink); }
    .chip.want { color: var(--lime); }
    .mini { all: unset; padding: 3px 9px; border-radius: 999px; font: 600 11.5px/1.4 "Inter", system-ui, sans-serif; background: var(--surface-2); color: var(--text); cursor: pointer; text-decoration: none; white-space: nowrap; }
    .mini:hover { background: #333; }
    .empty { padding: 4px 0 2px; color: var(--text-2); font-size: 13.5px; }
    .err { color: var(--bad); font-size: 13px; }
    .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-2); border-top-color: var(--lime); animation: sp .8s linear infinite; margin: 6px 0; }
    @keyframes sp { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const svg = (d) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    s.append(p);
    return s;
  };
  const link = (cls, text, href) => {
    const a = el("a", cls, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noreferrer";
    return a;
  };

  /** Eigener Bereich mit abgeschirmten Stilen: die Seite kann ihn nicht verformen und er die Seite nicht */
  function host(id) {
    document.getElementById(id)?.remove();
    const h = document.createElement("div");
    h.id = id;
    const root = h.attachShadow({ mode: "open" });
    root.append(el("style", null, CSS));
    const c = el("div", "c");
    root.append(c);
    document.documentElement.append(h);
    return { host: h, root: c };
  }

  /** Markenschrift nachladen. Klappt das auf einer Seite nicht, bleibt die Systemschrift. */
  function loadFont() {
    try {
      if ([...document.fonts].some((f) => f.family.includes("Crate Archivo"))) return;
      const f = new FontFace("Crate Archivo", `url(${chrome.runtime.getURL("fonts/archivo.woff2")})`, { weight: "100 900", stretch: "62% 125%" });
      document.fonts.add(f);
      f.load().catch(() => undefined);
    } catch {
      /* Systemschrift */
    }
  }

  function header(onClose, closeLabel, closeIcon) {
    const h = el("div", "head");
    const m = el("img", "mark");
    m.alt = "";
    m.src = chrome.runtime.getURL("icons/48.png");
    const x = el("button", "ic");
    x.type = "button";
    x.setAttribute("aria-label", closeLabel);
    x.title = closeLabel;
    x.append(svg(closeIcon));
    x.addEventListener("click", onClose);
    h.append(m, el("span", "word", "crate"), x);
    return h;
  }

  const money = (p) => new Intl.NumberFormat("de-DE", { style: "currency", currency: p.currency || "EUR" }).format(p.value);
  const day = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  };

  function signedOut(crateUrl) {
    const b = el("div", "body");
    b.append(el("p", "note", "Melde dich einmal in Crate an, dann zeigt dir die Erweiterung hier deine Sammlung."), link("btn primary", "Crate öffnen", crateUrl));
    return b;
  }

  function wantButton(id, on, onDone) {
    const b = el("button", on ? "btn" : "btn primary", on ? "Von der Wantlist nehmen" : "Auf die Wantlist");
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await send({ type: "want", id, on: !on });
      if (r.ok) onDone(!on);
      else {
        b.disabled = false;
        b.textContent = "Hat nicht geklappt";
      }
    });
    return b;
  }

  /** Feld zu einer Platte: Urteil groß, darunter was du über dein Exemplar weißt, Preis, Tracks mit Tempo und Tonart */
  function releaseBody(d, crateUrl, rerender) {
    const b = el("div", "body");
    const have = d.copies.length > 0;
    const v = el("div", `verdict ${have ? "have" : d.want ? "want" : "new"}`, have ? "Hast du schon" : d.want ? "Auf deiner Wantlist" : "Neu für dich");
    if (have && d.copies.length > 1) v.append(el("small", null, `${d.copies.length} Exemplare in deiner Sammlung`));
    else if (!have && d.price) v.append(el("small", null, `ab ${money(d.price)} · ${d.price.n === 1 ? "1 Angebot" : `${d.price.n} Angebote`}`));
    b.append(v);

    if (have) {
      const f = el("dl", "facts");
      const add = (k, val) => val && f.append(el("dt", null, k), el("dd", null, val));
      const c = d.copies[0];
      add("Ordner", [...new Set(d.copies.flatMap((x) => [x.folder, ...x.more]).filter(Boolean))].join(", "));
      add("Zustand", [c.media && `Platte ${c.media}`, c.sleeve && `Hülle ${c.sleeve}`].filter(Boolean).join(" · "));
      add("Bezahlt", c.paid);
      add("Seit", c.added ? day(c.added) : "");
      add("Regal", d.crate?.shelf);
      add("Verliehen", d.crate?.lentTo ? `an ${d.crate.lentTo}` : "");
      if (d.price) add("Markt", `ab ${money(d.price)} · ${d.price.n === 1 ? "1 Angebot" : `${d.price.n} Angebote`}`);
      if (f.children.length) b.append(f);
    }

    const tracks = (d.crate?.tracks ?? []).filter((t) => t.bpm || t.key);
    if (tracks.length) {
      const list = el("div", "tracks");
      for (const t of tracks.slice(0, 12)) {
        const r = el("div", "tr");
        const key = el("span", "key data", t.key ?? "");
        if (!t.key) key.style.visibility = "hidden";
        r.append(el("span", "pos data", t.position), el("span", "t", t.title), el("span", "bpm data", t.bpm ? Math.round(t.bpm) : ""), key);
        list.append(r);
      }
      b.append(list);
    } else if (have && d.crate && !d.crate.sync) {
      b.append(el("p", "note", "Tempo, Tonart und Sets stehen hier, sobald in Crate unter Einstellungen „Handy und Computer“ eingeschaltet ist."));
    }
    const sets = d.crate?.sets ?? [];
    if (sets.length) {
      const p = el("p", "note");
      p.append(el("b", null, sets.some((s) => s.played) ? "Gespielt in: " : "Eingeplant in: "), document.createTextNode(sets.map((s) => (s.date ? `${s.name} (${day(s.date)})` : s.name)).join(", ")));
      b.append(p);
    }

    const a = el("div", "actions");
    if (!have) a.append(wantButton(d.id, d.want, (now) => rerender({ ...d, want: now })));
    a.append(link(have ? "btn primary" : "btn", "In Crate öffnen", `${crateUrl}/release/${d.id}`));
    b.append(a);
    return b;
  }

  /** Trefferliste nach Text: bei jedem Treffer steht, ob er dir gehört */
  function results(items, crateUrl, discogsUrl) {
    const wrap = el("div", "body");
    if (!items.length) {
      wrap.append(el("p", "empty", "Nichts gefunden. Versuch es mit Artist und Titel oder der Katalognummer."));
      return wrap;
    }
    const list = el("div", "list");
    const draw = (r, into) => {
      const row = into ?? el("div", "row");
      row.replaceChildren();
      let pic;
      if (r.thumb) {
        pic = el("img");
        pic.alt = "";
        pic.loading = "lazy";
        pic.referrerPolicy = "no-referrer";
        pic.src = r.thumb;
        pic.addEventListener("error", () => pic.replaceWith(el("div", "ph")));
      } else pic = el("div", "ph");
      const main = el("div");
      const foot = el("div", "foot");
      foot.append(el("span", `chip ${r.have ? "have" : r.want ? "want" : ""}`, r.have ? "Hast du schon" : r.want ? "Auf der Wantlist" : "Neu für dich"));
      if (!r.have) {
        const w = el("button", "mini", r.want ? "Von der Wantlist" : "Auf die Wantlist");
        w.type = "button";
        w.addEventListener("click", async () => {
          w.disabled = true;
          const res = await send({ type: "want", id: r.id, on: !r.want });
          if (res.ok) draw({ ...r, want: !r.want }, row);
          else w.textContent = "Hat nicht geklappt";
        });
        foot.append(w);
      }
      foot.append(link("mini", "Crate", `${crateUrl}/release/${r.id}`), link("mini", "Discogs", `${discogsUrl}/release/${r.id}`));
      main.append(el("div", "ti", r.title), el("div", "sub", [r.label, r.year, r.format].filter(Boolean).join(" · ")), foot);
      row.append(pic, main);
      return row;
    };
    for (const r of items) list.append(draw(r));
    const credit = el("div", "credit");
    credit.append(link(null, "Data provided by Discogs.", discogsUrl));
    wrap.append(list, credit);
    return wrap;
  }

  globalThis.__crate = { send, el, svg, link, host, loadFont, header, signedOut, releaseBody, results, CSS };
})();
