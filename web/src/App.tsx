import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { getMe } from "./lib/api";
import { setState, useStore } from "./lib/store";
import { haptic, Jobs } from "./components/bits";
import { IconHeart, IconHome, IconList, IconRecord, IconSearch } from "./components/icons";
import Home from "./pages/Home";
import Login from "./pages/Login";
// Detailseite direkt laden, damit die Cover-Animation sofort ein Ziel hat
import ReleasePage from "./pages/Release";
const Collection = lazy(() => import("./pages/Collection"));
const Wantlist = lazy(() => import("./pages/Wantlist"));
const Search = lazy(() => import("./pages/Search"));
const Scan = lazy(() => import("./pages/Scan"));
const Shop = lazy(() => import("./pages/Shop"));
const Sets = lazy(() => import("./pages/Sets"));
const SetEditor = lazy(() => import("./pages/SetEditor"));
const Stickers = lazy(() => import("./pages/Stickers"));
const Settings = lazy(() => import("./pages/Settings"));

/** Nach dem Start: einmalige Bereinigung, dann Sync, wenn der letzte länger als 6 Stunden her ist (egal auf welcher Seite) */
async function startupSync() {
  const { migrateAudioMatching, autoPipeline } = await import("./lib/sync");
  const { getKV } = await import("./lib/db");
  const { toast } = await import("./lib/store");
  await migrateAudioMatching();
  const last = await getKV<number>("lastCollectionSync", 0);
  if (Date.now() - last > 6 * 3600_000 && navigator.onLine) {
    autoPipeline().catch((e) => toast(`Sync fehlgeschlagen: ${e.message}`));
  }
}

export default function App() {
  const me = useStore((s) => s.me);
  const [loaded, setLoaded] = useState(false);
  const loc = useLocation();
  const [barTitle, setBarTitle] = useState<string | null>(null);

  // Kompakte Titelleiste einblenden, sobald der große Titel aus dem Bild scrollt
  useEffect(() => {
    setBarTitle(null);
    document.documentElement.classList.remove("bar-on");
    window.scrollTo(0, 0);
    let io: IntersectionObserver | undefined;
    let tries = 0;
    const attach = () => {
      // Seiten mit eigener Navigationsleiste brauchen keine zusätzliche Titelleiste
      if (document.querySelector(".navbar")) return;
      const h = document.querySelector<HTMLElement>(".page-head h1, .stage h1");
      if (!h) {
        if (tries++ < 30) timer = setTimeout(attach, 100);
        return;
      }
      io = new IntersectionObserver(
        ([e]) => {
          setBarTitle(e.isIntersecting ? null : h.textContent);
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
    getMe()
      .then((m) => {
        setState({ me: m });
        if (m.username) void startupSync();
        try {
          localStorage.setItem("crate_me", JSON.stringify(m.username ? m : null));
        } catch {
          /* egal */
        }
      })
      .catch(() => setState({ me: cached }))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <div className="app" />;
  if (!me?.username) return <Login me={me} />;

  return (
    <div className="app">
      <div className={`topbar no-print ${barTitle ? "on" : ""}`} aria-hidden={!barTitle}>
        <div className="topbar-inner">{barTitle}</div>
      </div>
      <Suspense fallback={<div className="page" />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/wants" element={<Wantlist />} />
        <Route path="/search" element={<Search />} />
        <Route path="/release/:id" element={<ReleasePage />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/sets" element={<Sets />} />
        <Route path="/sets/:id" element={<SetEditor />} />
        <Route path="/stickers" element={<Stickers />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
      </Routes>
      </Suspense>
      <Jobs />
      <nav className="nav no-print">
        <div className="nav-inner">
          <NavLink to="/" end viewTransition onClick={() => haptic(5)}>
            <IconHome />
            Start
          </NavLink>
          <NavLink to="/search" viewTransition onClick={() => haptic(5)}>
            <IconSearch />
            Suche
          </NavLink>
          <NavLink to="/collection" viewTransition onClick={() => haptic(5)}>
            <IconRecord />
            Sammlung
          </NavLink>
          <NavLink to="/wants" viewTransition onClick={() => haptic(5)}>
            <IconHeart />
            Wants
          </NavLink>
          <NavLink to="/sets" viewTransition onClick={() => haptic(5)}>
            <IconList />
            Sets
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
