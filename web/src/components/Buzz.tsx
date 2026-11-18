// Soziales im Feed: Leiste unter jedem Beitrag (Gefällt mir, Kommentare), Kommentar-Blatt,
// Aktivitäts-Liste („Anna gefällt deine Platte“) und Empfehlen an Freunde.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release } from "../lib/db";
import { comment, deleteComment, forPost, markInboxRead, publishPlayedSets, react, recommend, setShareSets, shareSetsChoice, unpublish, useBuzz, type InboxItem } from "../lib/buzz";
import type { OwnPost, SetPostData, SpotPostData } from "../../../shared/ownPost";
import { toast, username } from "../lib/store";
import { agoText } from "../../../shared/friendFeed";
import { Avatar, Cover, Sheet, haptic, keepParens } from "./bits";
import { Switch } from "./ui";
import { IconChat, IconSend, IconThumb, IconX } from "./icons";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nameOf = (friends: { username: string; name?: string }[] | undefined, u: string) => friends?.find((f) => same(f.username, u))?.username ?? u;

/** „Gefällt Anna und 2 weiteren“ */
function likedBy(names: string[], mine: boolean): string {
  const list = [...(mine ? ["dir"] : []), ...names];
  if (!list.length) return "";
  if (list.length === 1) return `Gefällt ${list[0]}`;
  if (list.length === 2) return `Gefällt ${list[0]} und ${list[1]}`;
  return `Gefällt ${list[0]} und ${list.length - 1} weiteren`;
}

/** Leiste unter einem Beitrag im Feed */
export function PostBar({ feedId, title, releaseId }: { feedId: string; title: string; releaseId?: number }) {
  const buzz = useBuzz();
  const friends = useLiveQuery(() => db.friends.toArray(), []);
  const [open, setOpen] = useState(false);
  const { reactions, mine, comments } = forPost(buzz, feedId);
  const others = reactions.filter((r) => !same(r.from, username() ?? "")).map((r) => nameOf(friends, r.from));
  const toggle = () => {
    haptic(mine ? 5 : 14);
    react(feedId, !mine, { title, releaseId }).catch((e: Error) => toast(e.message));
  };
  return (
    <>
      <div className="fpost-bar">
        <button className={`fpost-act${mine ? " on" : ""}`} onClick={toggle} aria-pressed={mine} aria-label="Gefällt mir">
          <IconThumb />
          {reactions.length > 0 && <span>{reactions.length}</span>}
        </button>
        <button className="fpost-act" onClick={() => setOpen(true)} aria-label={`Kommentare (${comments.length})`}>
          <IconChat />
          {comments.length > 0 && <span>{comments.length}</span>}
        </button>
        {reactions.length > 0 && <span className="fpost-liked">{likedBy(others, mine)}</span>}
      </div>
      {comments.length > 0 && (
        <button className="fpost-last" onClick={() => setOpen(true)}>
          <b>{nameOf(friends, comments[comments.length - 1].from)}</b> {comments[comments.length - 1].text}
          {comments.length > 1 && <span> · alle {comments.length} ansehen</span>}
        </button>
      )}
      <ThreadSheet open={open} onClose={() => setOpen(false)} feedId={feedId} title={title} releaseId={releaseId} />
    </>
  );
}

/** Kommentare zu einem Beitrag, mit Eingabe */
function ThreadSheet({ open, onClose, feedId, title, releaseId }: { open: boolean; onClose: () => void; feedId: string; title: string; releaseId?: number }) {
  const buzz = useBuzz();
  const friends = useLiveQuery(() => db.friends.toArray(), []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const me = (username() ?? "").toLowerCase();
  const owner = feedId.split("|")[0];
  const { comments } = forPost(buzz, feedId);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await comment(feedId, t, { title, releaseId });
      setText("");
      haptic(10);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="thread stack">
        <div>
          <b className="thread-title">Kommentare</b>
          <span className="sub thread-sub">{title}</span>
        </div>
        {comments.length === 0 && <p className="sub">Noch nichts. Schreib den ersten Kommentar.</p>}
        <div className="thread-list">
          {comments.map((c) => {
            const f = friends?.find((x) => same(x.username, c.from));
            return (
              <div key={c.id} className="thread-row">
                <Avatar src={f?.avatar} name={c.from} size={32} />
                <div className="thread-body">
                  <span className="thread-who">
                    <b>{same(c.from, me) ? "Du" : f?.username ?? c.from}</b> <small>{agoText(c.ts)}</small>
                  </span>
                  <span className="thread-text">{c.text}</span>
                </div>
                {(same(c.from, me) || same(owner, me)) && (
                  <button className="thread-x" onClick={() => void deleteComment(c.id).catch((e: Error) => toast(e.message))} aria-label="Kommentar löschen">
                    <IconX />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <form
          className="thread-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input className="input" placeholder="Kommentar schreiben …" value={text} maxLength={280} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
          <button className="icon-btn round primary" disabled={!text.trim() || busy} aria-label="Senden">
            <IconSend />
          </button>
        </form>
      </div>
    </Sheet>
  );
}

const inboxText = (i: InboxItem) =>
  i.kind === "react" ? "gefällt deine Platte" : i.kind === "comment" ? "schreibt zu deiner Platte" : "empfiehlt dir";

/** Aktivität: was Freunde zu deinen Platten gesagt und dir empfohlen haben */
export function Activity({ limit = 8 }: { limit?: number }) {
  const buzz = useBuzz();
  const friends = useLiveQuery(() => db.friends.toArray(), []);
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Gelesen, sobald die Liste wirklich zu sehen war
  useEffect(() => {
    const el = box.current;
    if (!el || !buzz.unread) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e.isIntersecting) t = setTimeout(() => void markInboxRead(), 1800);
    });
    io.observe(el);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, [buzz.unread]);
  if (!buzz.inbox.length) return null;
  const items = all ? buzz.inbox : buzz.inbox.slice(0, limit);
  return (
    <section className="activity" ref={box}>
      <h3>
        Aktivität {buzz.unread > 0 && <span className="activity-n">{buzz.unread} neu</span>}
      </h3>
      <div className="activity-list">
        {items.map((i) => {
          const f = friends?.find((x) => same(x.username, i.from));
          const to = i.kind === "recommend" && i.releaseId ? `/release/${i.releaseId}` : i.releaseId ? `/release/${i.releaseId}` : `/friends/${encodeURIComponent(f?.username ?? i.from)}`;
          return (
            <Link key={i.id} to={to} viewTransition className={`activity-row press${i.read ? "" : " new"}`}>
              <Avatar src={f?.avatar} name={i.from} size={38} />
              <span className="activity-text">
                <span>
                  <b>{f?.username ?? i.from}</b> {inboxText(i)}
                  {i.title ? <> <em>{keepParens(i.title)}</em></> : null}
                </span>
                {i.text && <span className="activity-quote">„{i.text}“</span>}
                <small>{agoText(i.ts)}</small>
              </span>
            </Link>
          );
        })}
      </div>
      {!all && buzz.inbox.length > limit && (
        <button className="btn small ghost" onClick={() => setAll(true)}>
          Alle {buzz.inbox.length} ansehen
        </button>
      )}
    </section>
  );
}

/** Platte an Freunde empfehlen: Freunde antippen, kurzer Gruß dazu, senden */
export function RecommendSheet({ release, onClose }: { release: Release | null; onClose: () => void }) {
  const friends = useLiveQuery(() => db.friends.orderBy("addedAt").reverse().toArray(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (release) {
      setPicked([]);
      setText("");
    }
  }, [release?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!release || !picked.length) return;
    setBusy(true);
    const title = `${release.artist} – ${release.title}`;
    const res = await Promise.allSettled(picked.map((u) => recommend(u, release.id, title, text.trim() || undefined)));
    setBusy(false);
    const ok = res.filter((r) => r.status === "fulfilled").length;
    if (ok) {
      haptic(14);
      toast(ok === 1 ? "Empfehlung ist raus" : `${ok} Empfehlungen sind raus`);
      onClose();
    } else toast((res[0] as PromiseRejectedResult).reason?.message ?? "Senden ging nicht");
  };
  return (
    <Sheet open={Boolean(release)} onClose={onClose}>
      {release && (
        <div className="stack recommend">
          <div>
            <b className="thread-title">Empfehlen</b>
            <span className="sub thread-sub">
              {release.artist} – {keepParens(release.title)}
            </span>
          </div>
          {friends && friends.length === 0 && <p className="sub">Noch keine Freunde in Crate. Füg unter „Freunde“ jemanden hinzu.</p>}
          <div className="recommend-people">
            {friends?.map((f) => {
              const on = picked.includes(f.username);
              return (
                <button key={f.username} className={`fhome-person press${on ? " on" : ""}`} onClick={() => (haptic(5), setPicked((p) => (on ? p.filter((x) => x !== f.username) : [...p, f.username])))} aria-pressed={on}>
                  <span className={`fhome-ring${on ? " new" : ""}`}>
                    <Avatar src={f.avatar} name={f.username} size={56} />
                  </span>
                  <span className="fhome-name">{f.username}</span>
                </button>
              );
            })}
          </div>
          <input className="input" placeholder="Ein Satz dazu (freiwillig)" value={text} maxLength={280} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
          <button className="btn primary block lg" disabled={!picked.length || busy} onClick={() => void send()}>
            {busy ? "Sendet …" : picked.length > 1 ? `An ${picked.length} Freunde senden` : "Senden"}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** Eigener Beitrag im Feed: „hat ein Set gespielt“ oder „Platte des Moments“ */
export function OwnPostCard({ post, fresh }: { post: OwnPost; fresh?: boolean }) {
  const friends = useLiveQuery(() => db.friends.toArray(), []);
  const mine = same(post.owner, username() ?? "");
  const f = friends?.find((x) => same(x.username, post.owner));
  const who = mine ? "Du" : f?.name || f?.username || post.owner;
  const feedId = `${post.owner}|${post.kind}|${post.ref}`;
  const head = (text: string) => (
    <div className="fpost-head">
      <Avatar src={f?.avatar} name={mine ? (username() ?? "?") : post.owner} size={36} />
      <span className="fpost-who">
        <b>{who}</b> {text}
        <span className="fpost-when">
          {agoText(post.ts)}
          {fresh && <i className="fpost-new">neu</i>}
        </span>
      </span>
      {mine && (
        <button className="thread-x" onClick={() => void unpublish(post.kind, post.ref).then(() => toast("Beitrag entfernt"), (e: Error) => toast(e.message))} aria-label="Beitrag entfernen">
          <IconX />
        </button>
      )}
    </div>
  );
  if (post.kind === "set") {
    const d = post.data as SetPostData;
    const when = d.date ? new Date(d.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) : null;
    return (
      <article className="fpost">
        {mine ? head("hast ein Set gespielt") : <Link to={`/friends/${encodeURIComponent(f?.username ?? post.owner)}`} viewTransition className="press" style={{ color: "inherit" }}>{head("hat ein Set gespielt")}</Link>}
        <div className="fpost-set">
          <span className={`set-wall n${Math.min(d.covers.length, 4)}`}>
            {d.covers.slice(0, 4).map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" decoding="async" />
            ))}
            {d.covers.length === 0 && <span className="set-count">{d.tracks}</span>}
          </span>
          <span className="fpost-text">
            <b>{d.name}</b>
            <span>{[d.venue, when].filter(Boolean).join(" · ")}</span>
            <small>
              {d.tracks} Tracks{d.records ? ` · ${d.records} Platten` : ""}
            </small>
            {d.picks.length > 0 && <small className="fpost-picks">Mit {d.picks.map((p) => p.title).join(", ")}</small>}
          </span>
        </div>
        <PostBar feedId={feedId} title={`Set „${d.name}“`} />
      </article>
    );
  }
  const d = post.data as SpotPostData;
  return (
    <article className="fpost">
      {mine ? head("hast eine Platte des Moments") : <Link to={`/friends/${encodeURIComponent(f?.username ?? post.owner)}`} viewTransition className="press" style={{ color: "inherit" }}>{head("hat eine neue Platte des Moments")}</Link>}
      <div className="fpost-one">
        <Link to={`/release/${d.id}`} viewTransition className="fpost-rec press">
          <Cover src={d.cover} />
          <span className="fpost-text">
            <b>{keepParens(d.title)}</b>
            <span>{d.artist}</span>
          </span>
        </Link>
      </div>
      <PostBar feedId={feedId} title={`${d.artist} – ${d.title}`} releaseId={d.id} />
    </article>
  );
}

/** Schalter auf der Freunde-Seite: gespielte Sets im Feed zeigen */
export function ShareSetsSwitch() {
  const on = useLiveQuery(() => shareSetsChoice(), []);
  return (
    <div className="card row share-sets" style={{ gap: 12 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>Gespielte Sets im Feed zeigen</b>
        <span className="sub" style={{ display: "block" }}>Deine Freunde sehen Name, Ort, Anzahl der Tracks und ein paar Cover.</span>
      </span>
      <Switch
        checked={on === true}
        label="Gespielte Sets im Feed zeigen"
        onChange={(v) => {
          haptic(6);
          void setShareSets(v).then(() => (v ? publishPlayedSets() : undefined));
        }}
      />
    </div>
  );
}
