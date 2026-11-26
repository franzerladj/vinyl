// Suchfenster am Symbol: Artist, Titel oder Katalognummer eintippen, Crate sagt, ob du die Platte hast.
(async () => {
  const C = globalThis.__crate;
  const app = document.getElementById("app");
  const style = C.el("style", null, C.CSS.replace(":host { all: initial; }", ""));
  document.head.append(style);
  const root = C.el("div", "c");
  app.append(root);

  const urls = (await C.send({ type: "urls" })).data ?? { crate: "", discogs: "" };
  const head = C.header(() => window.close(), "Schließen", "M6 6l12 12M18 6L6 18");
  const form = C.el("form", "search");
  const input = C.el("input");
  input.type = "search";
  input.placeholder = "Artist, Titel oder Katalognummer";
  input.setAttribute("aria-label", "In Crate nachsehen");
  input.autocomplete = "off";
  input.spellcheck = false;
  const go = C.el("button", "btn primary", "Suchen");
  go.type = "submit";
  form.append(input, go);
  const status = C.el("div", "status");
  const out = C.el("div");
  root.append(head, form, status, out);
  input.focus();

  let run = 0;
  async function search(q) {
    const text = q.trim();
    if (text.length < 2) return;
    const mine = ++run;
    const wait = C.el("div", "body");
    wait.append(C.el("div", "spin"));
    out.replaceChildren(wait);
    const r = await C.send({ type: "search", q: text });
    if (mine !== run) return;
    if (r.ok) out.replaceChildren(C.results(r.data, urls.crate, urls.discogs));
    else if (r.signedOut) out.replaceChildren(C.signedOut(urls.crate));
    else {
      const b = C.el("div", "body");
      b.append(C.el("p", "err", r.error || "Das hat nicht geklappt."));
      out.replaceChildren(b);
    }
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void search(input.value);
  });

  // Aus dem Rechtsklick-Menü geöffnet (auf Seiten, die keine Einblendung erlauben)
  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    input.value = q;
    void search(q);
  }

  // Wer ist angemeldet, und gibt es Neues bei den Freunden?
  const c = (await C.send({ type: "counts" })).data;
  if (!c?.signedIn) {
    status.replaceChildren();
    if (!q) out.replaceChildren(C.signedOut(urls.crate));
    return;
  }
  const parts = [];
  if (c.messages) parts.push(c.messages === 1 ? "1 neue Nachricht" : `${c.messages} neue Nachrichten`);
  if (c.requests) parts.push(c.requests === 1 ? "1 Freundschaftsanfrage" : `${c.requests} Freundschaftsanfragen`);
  if (c.news) parts.push(c.news === 1 ? "1 Neuigkeit" : `${c.news} Neuigkeiten`);
  status.append(document.createTextNode(c.username ? `Angemeldet als ${c.username}` : "Angemeldet"));
  if (parts.length) {
    status.append(document.createTextNode(" · "));
    status.append(C.link(null, parts.join(", "), `${urls.crate}/friends`));
  }
  if (c.newer) {
    status.append(document.createElement("br"));
    status.append(C.link(null, `Version ${c.newer} der Erweiterung ist da`, `${urls.crate}/app`));
  }
})();
