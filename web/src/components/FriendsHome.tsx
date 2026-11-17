// Freunde auf der Startseite: Reihe mit allen Freunden (Ring = Neues) und „Neu bei Freunden“ als Feed,
// je Freund und Tag ein Beitrag. Logik in shared/friendFeed.ts.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Friend, type Release } from "../lib/db";
import { addWant } from "../lib/sync";
import { toast } from "../lib/store";
import { Avatar, Cover, haptic, keepParens, markHero } from "./bits";
import { IconHeart, IconPlus } from "./icons";
import { agoText, feedPosts, type FeedPost } from "../../../shared/friendFeed";
import type { FriendMatch } from "../lib/friends";

const SEEN = "crate:feed-seen";
const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN)) || 0;
  } catch {
    return 0;
  }
};

const headline = (p: FeedPost) => {
  const n = p.count;
  if (p.kind === "coll")
    return n === 1 ? "hat eine neue Platte" : `hat ${n} neue Platten`;
  return n === 1 ? "sucht eine Platte" : `sucht ${n} Platten`;
};

/** feedOnly: nur der Feed (Freunde-Seite), sonst mit Kopf und Freunde-Reihe (Start) */
export function FriendsHome({
  friends,
  limit = 5,
  feedOnly = false,
}: {
  friends: { f: Friend; m: FriendMatch }[];
  limit?: number;
  feedOnly?: boolean;
}) {
  // Stand beim Öffnen: was danach kam, gilt in dieser Ansicht als neu
  const [seen] = useState(readSeen);
  const data = useLiveQuery(async () => {
    const posts = feedPosts(await db.friendItems.toArray(), {
      limit: limit + 1,
      perPost: 12,
      sinceMs: Date.now() - 90 * 86_400_000,
    });
    const ids = [...new Set(posts.flatMap((p) => p.releaseIds))];
    const [rels, coll, wants] = await Promise.all([
      db.releases.bulkGet(ids),
      db.collection.toArray(),
      db.wants.toCollection().primaryKeys(),
    ]);
    return {
      posts,
      rels: new Map(rels.filter(Boolean).map((r) => [r!.id, r!])),
      mine: new Set(coll.map((c) => c.releaseId)),
      wants: new Set(wants as number[]),
    };
  }, [limit]);
  const byName = new Map(friends.map((x) => [x.f.username, x.f]));
  const allPosts = (data?.posts ?? []).filter(
    (p) =>
      byName.has(p.username) && p.releaseIds.some((id) => data!.rels.has(id)),
  );
  const posts = allPosts.slice(0, limit);
  const more = allPosts.length > limit;
  const fresh = new Set(
    posts.filter((p) => p.at > seen).map((p) => p.username),
  );

  // Gesehen merken, sobald der Feed wirklich auf dem Bildschirm war
  const feed = useRef<HTMLDivElement>(null);
  const newest = posts[0]?.at ?? 0;
  useEffect(() => {
    const el = feed.current;
    if (!el || !newest || newest <= seen) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(timer);
      if (e.isIntersecting)
        timer = setTimeout(() => {
          try {
            localStorage.setItem(SEEN, String(newest));
          } catch {
            /* egal */
          }
        }, 1500);
    });
    io.observe(el);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [newest, seen]);

  const [wanting, setWanting] = useState<number | null>(null);
  const want = async (r: Release) => {
    setWanting(r.id);
    haptic(14);
    try {
      await addWant(r.id);
      toast("Auf deiner Wantlist");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setWanting(null);
    }
  };

  const tag = (p: FeedPost, id: number) => {
    if (!data) return null;
    if (p.kind === "coll")
      return data.wants.has(id) ? (
        <span className="badge ok">auf deiner Wantlist</span>
      ) : data.mine.has(id) ? (
        <span className="badge">hast du auch</span>
      ) : null;
    return data.mine.has(id) ? (
      <span className="badge accent">hast du im Regal</span>
    ) : data.wants.has(id) ? (
      <span className="badge">suchst du auch</span>
    ) : null;
  };

  return (
    <section className={feedOnly ? "fhome only" : "fhome"}>
      {!feedOnly && (
        <>
          <div className="row fhome-head">
            <h2>Freunde</h2>
            <span className="spacer" />
            <Link
              to="/friends"
              viewTransition
              className="btn small ghost"
              style={{ paddingRight: 0 }}
            >
              Alle
            </Link>
          </div>

          {friends.length > 0 && (
      <div className="fhome-row">
            {friends.map(({ f, m }) => (
              <Link
                key={f.username}
                to={`/friends/${encodeURIComponent(f.username)}`}
                viewTransition
                className="fhome-person press"
              >
                <span
                  className={`fhome-ring${fresh.has(f.username) ? " new" : ""}`}
                >
                  <Avatar src={f.avatar} name={f.username} size={62} />
                  {m.hasYourWants.length > 0 && (
                    <span
                      className="fhome-count"
                      title="So viele deiner Wants stehen bei diesem Freund im Regal"
                    >
                      {m.hasYourWants.length}
                    </span>
                  )}
                </span>
                <span className="fhome-name">{f.username}</span>
              </Link>
            ))}
            <Link to="/friends" viewTransition className="fhome-person press">
              <span className="fhome-ring add">
                <IconPlus />
              </span>
              <span className="fhome-name sub">
                Hinzufügen
              </span>
            </Link>
          </div>
      )}
          {friends.some((x) => x.m.hasYourWants.length > 0) && (
            <p className="tiny fhome-note">
              Grüne Zahl: so viele deiner Wants stehen bei diesem Freund im
              Regal.
            </p>
          )}

          {friends.length === 0 && (
            <Link
              to="/friends"
              viewTransition
              className="card fhome-empty press"
            >
              <b>Hol deine Leute dazu</b>
              <span className="sub">
                Du siehst, was bei ihnen neu im Regal steht und wer eine deiner
                Wants hat.
              </span>
            </Link>
          )}
        </>
      )}

      {posts.length > 0 && (
        <div className="fhome-feed" ref={feed}>
          <h3>Neu bei Freunden</h3>
          {posts.map((p) => {
            const f = byName.get(p.username)!;
            const rels = p.releaseIds
              .map((id) => data!.rels.get(id))
              .filter(Boolean) as Release[];
            const one = rels.length === 1 ? rels[0] : null;
            return (
              <article key={p.id} className="fpost">
                <Link
                  to={`/friends/${encodeURIComponent(f.username)}`}
                  viewTransition
                  className="fpost-head press"
                >
                  <Avatar src={f.avatar} name={f.username} size={36} />
                  <span className="fpost-who">
                    <b>{f.name || f.username}</b>{" "}
                    {headline(p)}
                    <span className="fpost-when">
                      {agoText(p.at)}
                      {p.at > seen && <i className="fpost-new">neu</i>}
                    </span>
                  </span>
                </Link>
                {one ? (
                  <div className="fpost-one">
                    <Link
                      to={`/release/${one.id}`}
                      viewTransition
                      className="fpost-rec press"
                      state={{
                        preview: {
                          thumb: one.thumb,
                          cover: one.cover,
                          title: one.title,
                          artist: one.artist,
                        },
                      }}
                      onClick={(e) => markHero(e.currentTarget)}
                    >
                      <Cover src={one.cover || one.thumb} />
                      <span className="fpost-text">
                        <b>{keepParens(one.title)}</b>
                        <span>{one.artist}</span>
                        <small>
                          {[
                            one.labels[0]?.name.replace(/\s\(\d+\)$/, ""),
                            one.year || null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        {tag(p, one.id)}
                      </span>
                    </Link>
                    {p.kind === "coll" &&
                      data &&
                      !data.mine.has(one.id) &&
                      !data.wants.has(one.id) && (
                        <button
                          className="icon-btn round fpost-want"
                          disabled={wanting === one.id}
                          onClick={() => want(one)}
                          aria-label="Auf die Wantlist"
                        >
                          <IconHeart />
                        </button>
                      )}
                  </div>
                ) : (
                  <div className="fpost-strip">
                    {rels.map((r) => (
                      <Link
                        key={r.id}
                        to={`/release/${r.id}`}
                        viewTransition
                        className="press"
                        state={{
                          preview: {
                            thumb: r.thumb,
                            cover: r.cover,
                            title: r.title,
                            artist: r.artist,
                          },
                        }}
                        onClick={(e) => markHero(e.currentTarget)}
                      >
                        <Cover src={r.cover || r.thumb} />
                        <b>{r.title}</b>
                        <span>{r.artist}</span>
                        {tag(p, r.id)}
                      </Link>
                    ))}
                  {p.count > rels.length && (
                      <Link to={`/friends/${encodeURIComponent(f.username)}`} viewTransition className="fpost-more press">
                        <b>+{p.count - rels.length}</b>
                        <span>alle ansehen</span>
                      </Link>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {!feedOnly && more && (
        <Link
          to="/friends"
          viewTransition
          className="btn tinted block fhome-more"
        >
          Mehr von deinen Freunden
        </Link>
      )}
      {!feedOnly && friends.length > 0 && data && posts.length === 0 && (
        <p className="sub fhome-note">
          Noch nichts Neues. Der Feed füllt sich, sobald deine Freunde Platten
          eintragen.
        </p>
      )}
    </section>
  );
}
