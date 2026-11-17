import { useLocation, useNavigate } from "react-router-dom";
import { Pager } from "../components/Pager";
import Collection from "./Collection";
import Wantlist from "./Wantlist";

/** Tab „Platten“: Sammlung und Wantlist als zwei Seiten eines Pagers, beide bleiben geladen */
export default function Library() {
  const loc = useLocation();
  const nav = useNavigate();
  const index = loc.pathname.startsWith("/wants") ? 1 : 0;
  return (
    <Pager
      heads
      index={index}
      labels={["Sammlung", "Wantlist"]}
      switchClass="lib-switch no-print"
      // Adresse mitziehen, ohne dass die Seite nach oben springt
      onIndex={(i) =>
        nav(i ? "/wants" : "/collection", {
          replace: true,
          state: { keepScroll: true },
        })
      }
    >
      <Collection />
      <Wantlist />
    </Pager>
  );
}
