import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { getMe } from "./lib/api";
import { setState, useStore } from "./lib/store";
import { Jobs } from "./components/bits";
import { IconHeart, IconHome, IconList, IconRecord, IconSearch } from "./components/icons";
import Home from "./pages/Home";
import Login from "./pages/Login";
const Collection = lazy(() => import("./pages/Collection"));
const Wantlist = lazy(() => import("./pages/Wantlist"));
const Search = lazy(() => import("./pages/Search"));
const ReleasePage = lazy(() => import("./pages/Release"));
const Scan = lazy(() => import("./pages/Scan"));
const Shop = lazy(() => import("./pages/Shop"));
const Sets = lazy(() => import("./pages/Sets"));
const SetEditor = lazy(() => import("./pages/SetEditor"));
const Stickers = lazy(() => import("./pages/Stickers"));
const Settings = lazy(() => import("./pages/Settings"));

export default function App() {
  const me = useStore((s) => s.me);
  const [loaded, setLoaded] = useState(false);

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
      <Suspense fallback={<div className="empty">Lade …</div>}>
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
      </Routes>
      </Suspense>
      <Jobs />
      <nav className="nav no-print">
        <div className="nav-inner">
          <NavLink to="/" end>
            <IconHome />
            Start
          </NavLink>
          <NavLink to="/search">
            <IconSearch />
            Suche
          </NavLink>
          <NavLink to="/collection">
            <IconRecord />
            Sammlung
          </NavLink>
          <NavLink to="/wants">
            <IconHeart />
            Wants
          </NavLink>
          <NavLink to="/sets">
            <IconList />
            Sets
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
