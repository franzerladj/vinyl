// „Gut zu wissen“: kurze Karten rund um Platten, Nadel, Anlage und Auflegen (Inhalte in shared/guide.ts).
// Kein Blog: fest, ohne Datum, jede Karte mit ihren Quellen. /guide zeigt die Übersicht, /guide/<karte> eine Karte.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { NavBar } from "../components/ui";
import { IconCheck, IconExternal, IconX } from "../components/icons";
import { cardsOf, cardText, GUIDE, GUIDE_AREAS, guideArea, guideCard, nextCard, type GuideCard } from "../../../shared/guide";
import { matchesQuery } from "../../../shared/textSearch";

function CardRow({ c }: { c: GuideCard }) {
  return (
    <Link to={`/guide/${c.slug}`} viewTransition className="guide-row">
      <span className="guide-row-main">
        <b>{c.title}</b>
        <span>{c.lead}</span>
      </span>
      <span className="chev">›</span>
    </Link>
  );
}

function Index() {
  const [q, setQ] = useState("");
  const found = useMemo(() => (q.trim() ? GUIDE.filter((c) => matchesQuery(cardText(c), q)) : null), [q]);
  return (
    <>
      <NavBar title="Gut zu wissen" titleOnScroll backTo="/" backLabel="Start" />
      <div className="page-head" style={{ paddingTop: 0 }}>
        <div>
          <h1>Gut zu wissen</h1>
          <div className="sub">Platten, Nadel, Anlage, Auflegen. Jede Karte ist in einer halben Minute gelesen.</div>
        </div>
      </div>
      <div className="page guide">
        <input className="input guide-search" type="search" placeholder="Suchen, z. B. Auflagekraft" value={q} onChange={(e) => setQ(e.target.value)} aria-label="In den Karten suchen" enterKeyHint="search" />
        {found ? (
          found.length ? (
            <div className="group" style={{ marginTop: 14 }}>
              {found.map((c) => (
                <CardRow key={c.slug} c={c} />
              ))}
            </div>
          ) : (
            <p className="sub" style={{ marginTop: 18 }}>
              Dazu steht hier noch nichts.
            </p>
          )
        ) : (
          GUIDE_AREAS.map((a) => (
            <section key={a.id} className="guide-area">
              <h2>{a.title}</h2>
              <div className="sub">{a.sub}</div>
              <div className="group">
                {cardsOf(a.id).map((c) => (
                  <CardRow key={c.slug} c={c} />
                ))}
              </div>
            </section>
          ))
        )}
        <p className="tiny guide-foot">Die Ratschläge stammen aus Angaben von Herstellern und Archiven. Die Quellen stehen an jeder Karte.</p>
      </div>
    </>
  );
}

function Article({ card }: { card: GuideCard }) {
  const area = guideArea(card.area);
  const next = nextCard(card.slug);
  const see = (card.see ?? []).map(guideCard).filter(Boolean) as GuideCard[];
  return (
    <>
      {/* Kurzer Titel in der Leiste: ein langer Kartentitel nähme dem Zurück-Knopf den Platz (er würde abgeschnitten) */}
      <NavBar title="Gut zu wissen" titleOnScroll backTo="/guide" backLabel="Zurück" />
      <div className="page-head guide-head" style={{ paddingTop: 0 }}>
        <div>
          <div className="tiny guide-kicker">{area.title.replace("?", "")}</div>
          <h1>{card.title}</h1>
        </div>
      </div>
      <div className="page guide">
        <p className="guide-lead">{card.lead}</p>

        <h2>So machst du es</h2>
        <ul className="group guide-list">
          {card.todo.map((t) => (
            <li key={t}>
              <span className="guide-mark">
                <IconCheck />
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>

        {card.avoid?.length ? (
          <>
            <h2>Lass das</h2>
            <ul className="group guide-list">
              {card.avoid.map((t) => (
                <li key={t}>
                  <span className="guide-mark no">
                    <IconX />
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {card.more?.length ? (
          <>
            <h2>In Crate</h2>
            <div className="group">
              {card.more.map((m) => (
                <Link key={m.to} to={m.to} viewTransition className="group-row" style={{ color: "inherit", textDecoration: "none" }}>
                  <span style={{ flex: 1 }}>{m.label}</span>
                  <span className="chev">›</span>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {see.length ? (
          <>
            <h2>Passt dazu</h2>
            <div className="group">
              {see.map((c) => (
                <CardRow key={c.slug} c={c} />
              ))}
            </div>
          </>
        ) : null}

        <div className="guide-sources">
          <b>{card.sources.length ? (card.sources.length === 1 ? "Quelle" : "Quellen") : "Aus der Praxis"}</b>
          {card.practice && <p className="tiny">{card.sources.length ? "Diese Karte ist eine Liste aus der Praxis. Belegt ist nur, was die Quelle unten abdeckt." : "Diese Karte ist eine Liste aus der Praxis. Dafür gibt es keine Herstellerangabe."}</p>}
          {card.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
              <span>{s.label}</span>
              <IconExternal />
            </a>
          ))}
        </div>

        {next && (
          <Link to={`/guide/${next.slug}`} viewTransition className="btn tinted block lg guide-next">
            Weiter: {next.title}
          </Link>
        )}
      </div>
    </>
  );
}

export default function Guide() {
  const { slug } = useParams();
  const card = guideCard(slug);
  if (slug && !card)
    return (
      <>
        <NavBar title="Gut zu wissen" backTo="/guide" backLabel="Zurück" />
        <div className="page">
          <p className="sub">Diese Karte gibt es nicht (mehr).</p>
          <Link to="/guide" viewTransition className="btn tinted">
            Zur Übersicht
          </Link>
        </div>
      </>
    );
  // key: beim Wechsel von Karte zu Karte oben anfangen
  return card ? <Article key={card.slug} card={card} /> : <Index />;
}
