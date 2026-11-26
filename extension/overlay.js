// Einblendung nach Rechtsklick → „In Crate nachsehen“ auf beliebigen Seiten. Bekommt nur den markierten Text.
(() => {
  const C = globalThis.__crate;
  if (!C || globalThis.__crateOverlay) return;
  globalThis.__crateOverlay = true;

  let ui = null;
  const close = () => {
    ui?.host.remove();
    ui = null;
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => e.key === "Escape" && close();

  async function show(q) {
    close();
    C.loadFont();
    ui = C.host("crate-overlay");
    ui.host.style.cssText = "position:fixed;right:16px;top:16px;z-index:2147483600;width:380px;max-width:calc(100vw - 32px);";
    const card = C.el("div", "card");
    card.style.cssText = "max-height:calc(100vh - 32px);overflow:auto;";
    const body = C.el("div");
    card.append(C.header(close, "Schließen", "M6 6l12 12M18 6L6 18"), body);
    ui.root.append(card);
    document.addEventListener("keydown", onKey, true);
    const wait = C.el("div", "body");
    wait.append(C.el("p", "note", `Suche nach „${q}“ …`), C.el("div", "spin"));
    body.replaceChildren(wait);
    const [urls, r] = await Promise.all([C.send({ type: "urls" }), C.send({ type: "search", q })]);
    if (!ui) return;
    if (r.ok) body.replaceChildren(C.results(r.data, urls.data?.crate ?? "", urls.data?.discogs ?? ""));
    else if (r.signedOut) body.replaceChildren(C.signedOut(urls.data?.crate ?? ""));
    else {
      const b = C.el("div", "body");
      b.append(C.el("p", "err", r.error || "Das hat nicht geklappt."));
      body.replaceChildren(b);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "crate-overlay" && msg.q) void show(String(msg.q));
  });
})();
