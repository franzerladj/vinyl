import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType, useRouteError, type RouteObject } from "react-router-dom";
import { getMe } from "./lib/api";
import { setState, toast, useStore } from "./lib/store";
import { haptic, Jobs, Sheet } from "./components/bits";
import { Welcome } from "./components/Welcome";
import { RecordMenu } from "./components/RecordMenu";
import { PullRefresh } from "./components/PullRefresh";
import { MiniPlayer } from "./components/MiniPlayer";
import { claimDevice } from "./lib/account";
import { IconCart, IconGear, IconHeart, IconHome, IconList, IconPlay, IconRecord, IconSearch, IconUser } from "./components/icons";
import { LogoMark, Wordmark } from "./components/Logo";
import Home from "./pages/Home";
import Login, { LoginFinish } from "./pages/Login";
import { claimIdentity, verifyInBackground } from "./lib/auth";
// Früh laden: die Hooks schreiben jede eigene Änderung für den Geräte-Abgleich mit
import { startDevSync } from "./lib/devsync";
import { noteLocation, rememberScroll, tabOf, tabTarget, takePendingScroll, type TabId } from "./lib/tabs";
import { useLiveQuery } from "dexie-react-hooks";
import { cachedSocial } from "./lib/social";
// Detailseite direkt laden, damit die Cover-Animation sofort ein Ziel hat
import ReleasePage from "./pages/Release";
/**
 * Seite mit eigenem Code-Paket. Wird im Leerlauf vorgeladen (preloadPages); ist sie schon geladen,
 * rendert sie sofort ohne Suspense-Umweg. Sonst hinge beim ersten Öffnen das Laden und Vorbereiten
 * des Codes mitten im Seitenwechsel (bis 170 ms Stillstand auf einem mittleren Handy).
 */
type PageModule = { default: React.ComponentType };
const preloaders: (() => Promise<unknown>)[] = [];
function page(load: () => Promise<PageModule>) {
  let mod: PageModule | null = null;
  const get = () => load().then((m) => (mod = m));
  const Lazy = lazy(() => get());
  preloaders.push(get);
  return function Page() {
    // Einmal pro Seite festlegen: ein Wechsel von Lazy auf das geladene Modul würde die Seite neu aufbauen
    // (Pager verlöre seinen Zustand, Formulare ihre Eingaben)
    const [C] = useState<React.ComponentType>(() => (mod ? mod.default : Lazy));
    return <C />;
  };
}
/** Kurzes Einblenden des Inhalts beim Tab-Wechsel (nur Deckkraft, läuft auf der Grafikkarte) */
function tabFade() {
  const main = document.querySelector<HTMLElement>(".main");
  if (!main) return;
  main.classList.remove("tab-enter");
  requestAnimationFrame(() => {
    main.classList.add("tab-enter");
    setTimeout(() => main.classList.remove("tab-enter"), 260);
  });
}

/** Nach dem Start, wenn nichts los ist: alle Seiten nacheinander vorladen */
export function preloadPages() {
  const idle = (fn: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 400));
  let i = 0;
  const next = () => {
    const p = preloaders[i++];
    if (!p) return;
    void p().catch(() => undefined).finally(() => idle(next));
  };
  idle(next);
}
const Library = page(() => import("./pages/Library"));
const Search = page(() => import("./pages/Search"));
const Scan = page(() => import("./pages/Scan"));
const Shop = page(() => import("./pages/Shop"));
const LabelPage = page(() => import("./pages/LabelPage"));
const YearPage = page(() => import("./pages/YearPage"));
const LabelsIndex = page(() => import("./pages/LabelPage").then((m) => ({ default: m.LabelsIndex })));
const Sets = page(() => import("./pages/Sets"));
const SetEditor = page(() => import("./pages/SetEditor"));
const SharedSetPage = page(() => import("./pages/SharedSetPage"));
const Stickers = page(() => import("./pages/Stickers"));
const Settings = page(() => import("./pages/Settings"));
const Friends = page(() => import("./pages/Friends"));
const Dig = page(() => import("./pages/Dig"));
const GetApp = page(() => import("./pages/GetApp"));
const DjPage = page(() => import("./pages/DjPage"));
const Impressum = page(() => import("./pages/Legal").then((m) => ({ default: m.Impressum })));
const Datenschutz = page(() => import("./pages/Legal").then((m) => ({ default: m.Datenschutz })));

/** Seiten, die auch ohne Anmeldung erreichbar sein müssen (App-Store-Prüfung, Login-Seite) */
const PUBLIC = new Set(["/impressum", "/datenschutz", "/app"]);

/** Alle Seiten der App (Data-Router, damit Seitenübergänge und Zurück-Animationen funktionieren) */
export const routes: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: "collection", element: <Library /> },
  { path: "wants", element: <Library /> },
  { path: "search", element: <Search /> },
  { path: "dig", element: <Dig /> },
  { path: "release/:id", element: <ReleasePage /> },
  { path: "scan", element: <Scan /> },
  { path: "shop", element: <Shop /> },
  { path: "label/:id", element: <LabelPage /> },
  { path: "labels", element: <LabelsIndex /> },
  { path: "year", element: <YearPage /> },
  { path: "dj", element: <DjPage /> },
  { path: "year/:year", element: <YearPage /> },
  { path: "sets", element: <Sets /> },
  { path: "sets/shared", element: <SharedSetPage /> },
  { path: "sets/:id", element: <SetEditor /> },
  { path: "stickers", element: <Stickers /> },
  { path: "settings", element: <Settings /> },
  { path: "settings/:section", element: <Settings /> },
  { path: "friends", element: <Friends /> },
  { path: "friends/:username", element: <Friends /> },
  { path: "app", element: <GetApp /> },
  { path: "impressum", element: <Impressum /> },
  { path: "datenschutz", element: <Datenschutz /> },
  { path: "*", element: <NotFound /> },
];

/** Fehlerseite statt weißem Bildschirm. Nach einem Update fehlen alte Dateien: dann neu laden. */
export function ErrorPage() {
  const err = useRouteError() as Error | undefined;
  const stale = /dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i.test(String(err?.message ?? err));
  useEffect(() => {
    if (stale && !sessionStorage.getItem("crate:reloaded")) {
      sessionStorage.setItem("crate:reloaded", "1");
      location.reload();
    }
  }, [stale]);
  return (
    <div className="empty" style={{ minHeight: "80vh", justifyContent: "center", padding: 24 }}>
      <b style={{ fontSize: 20 }}>{stale ? "Neue Version wird geladen …" : "Da ist etwas schiefgelaufen"}</b>
      {!stale && <span className="sub">Deine Daten sind sicher, sie liegen auf dem Gerät. Neu laden hilft meistens.</span>}
      <button className="btn primary" onClick={() => location.reload()}>
        Neu laden
      </button>
      <a className="btn ghost" href="/">
        Zur Startseite
      </a>
      {!stale && err?.message && <code className="tiny" style={{ maxWidth: 420, wordBreak: "break-word" }}>{err.message}</code>}
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function NotFound() {
  return (
    <div className="empty" style={{ minHeight: "70vh", justifyContent: "center" }}>
      <b>Seite nicht gefunden</b>
      <a className="btn primary" href="/">
        Zur Startseite
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scroll-Position pro Verlaufseintrag merken. Beim Zurückgehen wird sie
// wiederhergestellt, sobald die (asynchron geladene) Liste lang genug ist,
// und der zuletzt angetippte Eintrag wird kurz hervorgehoben.
// ---------------------------------------------------------------------------
const scrollMemo = new Map<string, number>();
try {
  Object.entries(JSON.parse(sessionStorage.getItem("crate:scroll") ?? "{}")).forEach(([k, v]) => scrollMemo.set(k, Number(v)));
} catch {
  /* egal */
}
const saveScrollMemo = () => {
  try {
    sessionStorage.setItem("crate:scroll", JSON.stringify(Object.fromEntries([...scrollMemo].slice(-60))));
  } catch {
    /* egal */
  }
};

function useScrollMemory() {
  const loc = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    const key = loc.key;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        scrollMemo.set(key, window.scrollY);
        rememberScroll(loc.pathname + loc.search, window.scrollY);
        saveScrollMemo();
      }, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // Wechsel im Pager (Sammlung/Wantlist): Position bleibt, der Pager hat sie schon gesetzt
    if ((loc.state as { keepScroll?: boolean } | null)?.keepScroll) {
      return () => {
        window.removeEventListener("scroll", onScroll);
        clearTimeout(t);
      };
    }
    // Zurück/Vor: alte Position anfahren; neue Seite: nach oben
    const fromTab = takePendingScroll(loc.pathname + loc.search);
    const target = fromTab ?? (type === "POP" ? scrollMemo.get(key) ?? 0 : 0);
    let tries = 0;
    const restore = () => {
      // Nach oben braucht keine Messung (scrollHeight zwingt den Browser, die neue Seite sofort durchzurechnen)
      const max = target <= 0 ? 0 : document.documentElement.scrollHeight - window.innerHeight;
      if (max >= target - 4 || tries > 40) {
        window.scrollTo(0, target);
        if (type === "POP") {
          const last = sessionStorage.getItem(`crate:tap:${loc.pathname}`);
          const el = last ? document.querySelector<HTMLElement>(`[data-key="${CSS.escape(last)}"]`) : null;
          if (el) {
            // Ohne erzwungenes Neuberechnen neu starten: im nächsten Bild wieder anhängen
            el.classList.remove("last-tapped");
            requestAnimationFrame(() => el.classList.add("last-tapped"));
          }
        }
        return;
      }
      tries++;
      requestAnimationFrame(() => setTimeout(restore, 30));
    };
    // Erst im nächsten Bild: dann ist die neue Seite ohnehin berechnet
    if (target <= 0) restore();
    else requestAnimationFrame(restore);
    return () => {
      // Nicht hier speichern: beim Seitenwechsel ist die Position schon vom Browser verfälscht
      window.removeEventListener("scroll", onScroll);
      clearTimeout(t);
    };
  }, [loc.key, loc.pathname, type]);

  // Zuletzt angetippten Listeneintrag pro Seite merken
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Position im Moment des Antippens festhalten, bevor die neue Seite sie verändert
      const k = (window.history.state as { key?: string } | null)?.key;
      if (k) {
        scrollMemo.set(k, window.scrollY);
        saveScrollMemo();
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
      if (el) sessionStorage.setItem(`crate:tap:${location.pathname}`, el.dataset.key!);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

let busyCheck: () => boolean = () => false;
const pipelineBusy = () => busyCheck();

/** Nach dem Start: einmalige Bereinigung, dann Sync, wenn der letzte länger als 6 Stunden her ist (egal auf welcher Seite) */
/**
 * Einmalige Bereinigungen alter Stände. Laufen vor dem Abgleich zwischen Geräten: auf einem frischen Gerät
 * ist dann noch nichts da, was sie verwerfen könnten (sonst träfen sie die gerade abgeholten Werte der anderen Geräte).
 */
async function runMigrations() {
  const { migrateAudioMatching, migrateAlbumMatching, migrateTempoV2 } = await import("./lib/sync");
  await migrateAudioMatching();
  await migrateAlbumMatching();
  await migrateTempoV2();
}

async function startupSync() {
  const { autoPipeline, isPipelineRunning } = await import("./lib/sync");
  busyCheck = isPipelineRunning;
  const { getKV } = await import("./lib/db");
  const { toast } = await import("./lib/store");
  // Vorhandene Tempi nach den neuen Regeln prüfen (lokal, ohne Downloads)
  await import("./lib/tempo").then((m) => m.migrateTempoCheck()).catch((e) => console.warn("Tempo", e));
  void import("./lib/friends").then((f) => f.refreshMyProfile()).catch(() => undefined);
  const run = async () => {
    if (!navigator.onLine) return;
    // Freundschaftsanfragen und Zusagen abholen
    void import("./lib/social").then((m) => m.refreshSocial()).catch(() => undefined);
    // Offene Ordner-Änderungen (z. B. App beim Einsortieren geschlossen) weiter zu Discogs schicken
    void import("./lib/folders").then((f) => f.resumeFolderQueue()).catch(() => undefined);
    const last = await getKV<number>("lastCollectionSync", 0);
    // Länger als 6 Stunden her: komplett abgleichen. Sonst nur fortsetzen, was noch fehlt (kostet fast nichts).
    autoPipeline({ resume: Date.now() - last < 6 * 3600_000 }).catch((e) => toast(`Sync fehlgeschlagen: ${e.message}`));
  };
  await run();
  // Kommt die App aus dem Hintergrund zurück, geht es dort weiter, wo sie unterbrochen wurde
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 20_000) void run();
  });
  window.addEventListener("online", () => void run());
  // Versehentliches Neuladen während eines Syncs: Browser fragt nach
  window.addEventListener("beforeunload", (e) => {
    if (pipelineBusy()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/**
 * Wischen vom linken Rand zurück, wie in iOS-Apps. Nur in der installierten App
 * (im Safari-Tab übernimmt das Safari selbst).
 */
function useBackGesture() {
  const loc = useLocation();
  useEffect(() => {
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (!standalone || loc.pathname === "/") return;
    const root = document.querySelector<HTMLElement>(".app");
    if (!root) return;
    let x0: number | null = null;
    let y0 = 0;
    let dx = 0;
    let horizontal: boolean | null = null;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t.clientX > 22) return;
      x0 = t.clientX;
      y0 = t.clientY;
      dx = 0;
      horizontal = null;
    };
    const move = (e: TouchEvent) => {
      if (x0 == null) return;
      const t = e.touches[0];
      dx = Math.max(0, t.clientX - x0);
      if (horizontal == null && (dx > 8 || Math.abs(t.clientY - y0) > 8)) horizontal = dx > Math.abs(t.clientY - y0);
      if (!horizontal) return;
      root.style.transition = "none";
      root.style.transform = `translateX(${dx}px)`;
      root.style.boxShadow = "-12px 0 30px rgba(0,0,0,.35)";
    };
    const end = () => {
      if (x0 == null) return;
      const w = window.innerWidth;
      if (horizontal && dx > w * 0.33) {
        root.style.transition = "transform .22s var(--ease)";
        root.style.transform = `translateX(${w}px)`;
        document.documentElement.classList.add("vt-none");
        setTimeout(() => {
          history.back();
          setTimeout(() => {
            root.style.transition = "none";
            root.style.transform = "";
            root.style.boxShadow = "";
            document.documentElement.classList.remove("vt-none");
          }, 60);
        }, 200);
      } else {
        root.style.transition = "transform .35s var(--spring)";
        root.style.transform = "";
        root.style.boxShadow = "";
      }
      x0 = null;
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [loc.pathname]);
}

export default function App() {
  const me = useStore((s) => s.me);
  const social = useLiveQuery(() => cachedSocial(), []);
  const [loaded, setLoaded] = useState(false);
  const online = useOnline();
  const loc = useLocation();
  const navigate = useNavigate();
  const activeTab = tabOf(loc.pathname);
  useEffect(() => {
    noteLocation(loc.pathname, loc.pathname + loc.search);
  }, [loc.pathname, loc.search]);
  const [barTitle, setBarTitle] = useState<string | null>(null);
  useScrollMemory();
  useBackGesture();

  // Kompakte Titelleiste einblenden, sobald der große Titel aus dem Bild scrollt
  useEffect(() => {
    setBarTitle(null);
    document.documentElement.classList.remove("bar-on");
    let io: IntersectionObserver | undefined;
    let tries = 0;
    const attach = () => {
      // Seiten mit eigener Navigationsleiste brauchen keine zusätzliche Titelleiste
      if (document.querySelector(".navbar")) return;
      const h = document.querySelector<HTMLElement>(".page-head h1, .stage h1, .home-hero h1");
      if (!h) {
        if (tries++ < 30) timer = setTimeout(attach, 100);
        return;
      }
      io = new IntersectionObserver(
        ([e]) => {
          // Seiten mit eigener Werkzeugleiste zeigen den kleinen Titel in der Leiste selbst
          setBarTitle(e.isIntersecting || document.querySelector(".toolbar") ? null : h.textContent);
          // Klebende Werkzeugleisten rücken unter die kompakte Titelleiste
          document.documentElement.classList.toggle("bar-on", !e.isIntersecting);
        },
        { rootMargin: "-48px 0px 0px 0px" },
      );
      io.observe(h);
    };
    let timer = setTimeout(attach, 30);
    return () => {
      clearTimeout(timer);
      io?.disconnect();
    };
  }, [loc.pathname]);

  useEffect(() => {
    // Offline (z.B. im Club ohne Netz) mit dem zuletzt bekannten Login weitermachen
    const cached = (() => {
      try {
        return JSON.parse(localStorage.getItem("crate_me") ?? "null");
      } catch {
        return null;
      }
    })();
    if (new URLSearchParams(location.search).get("oauth_verifier")) return setLoaded(true);
    getMe()
      .then(async (m) => {
        // Angemeldet, aber der Name fehlt noch (Discogs war beim Anmelden ausgelastet): direkt nachfragen
        // Name noch nicht vom Server bestätigt (Discogs bremst ihn gerade): nicht abmelden.
        // Das Gerät fragt den Namen selbst, der Server bestätigt ihn im Hintergrund.
        if (m.needIdentity) {
          if (!m.username) m = { ...m, username: (await claimIdentity()) ?? cached?.username ?? null };
          verifyInBackground((name) => {
            setState({ me: { ...m, username: name, verified: true, needIdentity: false } });
            void startDevSync();
          });
        }
        // Anderes Konto als zuletzt auf diesem Gerät: lokale Daten des vorherigen Kontos entfernen
        if (m.username && (await claimDevice(m.username).catch(() => false))) toast("Neues Konto auf diesem Gerät: die Daten des vorherigen Kontos wurden entfernt.");
        setState({ me: m });
        // Erst die Änderungen der anderen Geräte holen (höchstens ein paar Sekunden warten), dann den Discogs-Sync
        if (m.username) {
          const verified = m.verified !== false;
          const ready = runMigrations()
            .catch((e) => console.warn("Bereinigung", e))
            .then(() => (verified ? Promise.race([startDevSync().catch(() => undefined), new Promise((r) => setTimeout(r, 6000))]) : undefined));
          void ready.then(() => startupSync());
        }
        try {
          localStorage.setItem("crate_me", JSON.stringify(m.username ? m : null));
        } catch {
          /* egal */
        }
      })
      .catch(() => setState({ me: cached }))
      .finally(() => {
        setLoaded(true);
        // Mitteilungen gewünscht und inzwischen erlaubt (z. B. aus den Android-Einstellungen zurück): selbst einschalten
        const resume = () =>
          void import("./lib/push").then((p) => p.resumePushIfWanted()).then((ok) => ok && toast("Mitteilungen sind an"));
        resume();
        document.addEventListener("visibilitychange", () => !document.hidden && resume());
        // Nach dem ersten Bild die übrigen Seiten im Leerlauf vorladen
        setTimeout(preloadPages, 1500);
      });
  }, []);

  // Am Computer: „/“ springt in die Suche der Seite (oder zur Suche)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      const el = document.querySelector<HTMLInputElement>(".pager-pane.on .search-bar input") ?? document.querySelector<HTMLInputElement>(".search-bar input, input[type=search]");
      e.preventDefault();
      if (el) el.focus();
      else window.location.assign("/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (PUBLIC.has(loc.pathname))
    return (
      <div className="app">
        <Suspense fallback={<div className="page" />}>
          <Outlet />
        </Suspense>
      </div>
    );
  const oauthBack = new URLSearchParams(loc.search);
  if (oauthBack.get("oauth_verifier") && oauthBack.get("oauth_token")) return <LoginFinish token={oauthBack.get("oauth_token")!} verifier={oauthBack.get("oauth_verifier")!} />;
  if (!loaded) return <div className="app" />;
  if (!me?.username) {
    // Geteilten Link nach der Anmeldung wieder öffnen
    if (loc.pathname !== "/")
      try {
        sessionStorage.setItem("crate:after", loc.pathname + loc.search + loc.hash);
      } catch {
        /* egal */
      }
    return <Login me={me} />;
  }

  return (
    <div className="app">
      {!online && <div className="offline-bar no-print">Offline · du siehst die Daten auf dem Gerät</div>}
      <div className={`topbar no-print ${barTitle ? "on" : ""}`} aria-hidden={!barTitle}>
        <div className="topbar-inner">{barTitle}</div>
      </div>
      {/* Am Computer: Seitenleiste statt Tab-Leiste unten (per CSS ab 1024 px) */}
      <aside className="side no-print" aria-label="Navigation">
        <NavLink to="/" end viewTransition className="side-brand" aria-label="Start">
          <LogoMark size={34} />
          <Wordmark className="side-word" />
        </NavLink>
        <nav className="side-nav">
          <NavLink to="/" end viewTransition>
            <IconHome />
            Start
          </NavLink>
          <NavLink to="/search" viewTransition>
            <IconSearch />
            Suche
          </NavLink>
          <NavLink to="/collection" viewTransition>
            <IconRecord />
            Sammlung
          </NavLink>
          <NavLink to="/wants" viewTransition>
            <IconHeart />
            Wantlist
          </NavLink>
          <NavLink to="/sets" viewTransition>
            <IconList />
            Sets
          </NavLink>
          <span className="side-sep" />
          <NavLink to="/dig" viewTransition>
            <IconPlay />
            Diggen
          </NavLink>
          <NavLink to="/shop" viewTransition>
            <IconCart />
            Shoppen
          </NavLink>
          <NavLink to="/friends" viewTransition>
            <IconUser />
            Freunde
          </NavLink>
        </nav>
        <NavLink to="/settings" viewTransition className="side-me">
          <IconGear />
          <span>
            Einstellungen
            <small>{me.username}</small>
          </span>
        </NavLink>
      </aside>
      <main className="main">
        <Suspense fallback={<div className="page" />}>
          <Outlet />
        </Suspense>
      </main>
      <MiniPlayer />
      <PullRefresh />
      <RecordMenu />
      <Jobs />
      {me?.username && <Welcome username={me.username} />}
      {/* Fünf Orte: Start, Diggen, Sammlung (mit Wantlist), Sets, Freunde. Suche, Scannen und Shop hängen an diesen Seiten. */}
      <nav className="nav no-print">
        <div className="nav-inner">
          {(
            [
              ["home", "/", <IconHome key="i" />, "Start"],
              ["dig", "/dig", <IconPlay key="i" />, "Diggen"],
              ["coll", "/collection", <IconRecord key="i" />, "Platten"],
              ["sets", "/sets", <IconList key="i" />, "Sets"],
              ["friends", "/friends", <IconUser key="i" />, "Freunde"],
            ] as [TabId, string, React.ReactNode, string][]
          ).map(([id, root, icon, label]) => (
            <a
              key={id}
              href={root}
              className={[activeTab === id ? "active" : "", id === "friends" && social?.in.length ? "has-dot" : ""].filter(Boolean).join(" ") || undefined}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                haptic(5);
                const dest = tabTarget(id, loc.pathname + loc.search);
                if (dest == null) window.scrollTo({ top: 0, behavior: "smooth" });
                else {
                  // Wie bei iOS: Tabs wechseln sofort, nur ein kurzes Einblenden (kein Abfotografieren ganzer Seiten)
                  tabFade();
                  navigate(dest);
                }
              }}
            >
              {icon}
              {label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
