// Feld auf Discogs-Plattenseiten. Von der Seite wird nichts gelesen: die Nummer steht in der Adresse
// (…/release/12345-Artist-Titel für eine Pressung, …/master/678-Artist-Titel für alle Pressungen einer Platte),
// alles andere kommt über die Schnittstelle.
(() => {
  const C = globalThis.__crate;
  if (!C || globalThis.__crateDiscogs) return;
  globalThis.__crateDiscogs = true;

  const refOf = (path) => {
    const m = /\/(release|master)\/(\d+)/.exec(path);
    return m ? { kind: m[1], id: Number(m[2]), key: `${m[1]}:${m[2]}` } : null;
  };
  let shown = null;
  let ui = null;
  let open = true;

  async function show(ref) {
    const id = ref?.key ?? null;
    shown = id;
    if (!ref) {
      ui?.host.remove();
      ui = null;
      return;
    }
    C.loadFont();
    open = (await chrome.storage.local.get("panelOpen")).panelOpen !== false;
    ui = C.host("crate-panel");
    ui.host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483600;width:320px;max-width:calc(100vw - 32px);";
    const card = C.el("div", "card");
    card.style.cssText = "max-height:calc(100vh - 32px);overflow:auto;";
    ui.root.append(card);
    const body = C.el("div");
    const paint = () => {
      body.style.display = open ? "" : "none";
      head.querySelector("button").replaceChildren(C.svg(open ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"));
      head.querySelector("button").setAttribute("aria-expanded", String(open));
    };
    const head = C.header(
      () => {
        open = !open;
        void chrome.storage.local.set({ panelOpen: open });
        paint();
      },
      "Crate ein- oder ausklappen",
      "M6 9l6 6 6-6",
    );
    card.append(head, body);
    paint();
    const wait = C.el("div", "body");
    wait.append(C.el("div", "spin"));
    body.replaceChildren(wait);

    const [urls, r] = await Promise.all([C.send({ type: "urls" }), C.send({ type: ref.kind, id: ref.id })]);
    if (shown !== id) return; // inzwischen weitergeblättert
    const crateUrl = urls.data?.crate ?? "";
    const draw = (d) => body.replaceChildren(C.releaseBody(d, crateUrl, draw));
    // Master: nach dem Umschalten der Wantlist neu fragen, die Liste der Pressungen ändert sich mit
    const drawMaster = (d) =>
      body.replaceChildren(
        C.masterBody(d, crateUrl, async () => {
          const again = await C.send({ type: "master", id: ref.id });
          if (shown === id && again.ok) drawMaster(again.data);
        }),
      );
    if (r.ok && ref.kind === "master") drawMaster(r.data);
    else if (r.ok) draw(r.data);
    else if (r.signedOut) body.replaceChildren(C.signedOut(crateUrl));
    else {
      const b = C.el("div", "body");
      b.append(C.el("p", "err", r.error || "Das hat nicht geklappt."));
      body.replaceChildren(b);
    }
  }

  // Discogs wechselt Seiten ohne Neuladen: die Adresse im Blick behalten
  let last = null;
  const check = () => {
    const ref = refOf(location.pathname);
    if ((ref?.key ?? null) !== last) {
      last = ref?.key ?? null;
      void show(ref);
    }
  };
  check();
  setInterval(check, 900);
})();
