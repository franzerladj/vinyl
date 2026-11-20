// Unterhaltungen mit Freunden als Liste (auf der Freunde-Seite)
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Avatar } from "./bits";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { dmPreview, refreshThreads, useThreads } from "../lib/dm";
import { agoText } from "../../../shared/friendFeed";

export function Messages() {
  const me = useStore((s) => s.me)?.username ?? "";
  const threads = useThreads();
  const friends = useLiveQuery(() => db.friends.toArray(), [], []);
  useEffect(() => {
    void refreshThreads();
  }, []);
  if (!threads.length) return null;
  const unread = threads.reduce((n, t) => n + t.unread, 0);
  return (
    <section className="activity">
      <h3>
        Nachrichten
        {unread > 0 && <span className="activity-n">{unread}</span>}
      </h3>
      <div className="dm-list">
        {threads.map((t) => {
          const f = friends.find((x) => x.username.toLowerCase() === t.with);
          return (
            <Link key={t.with} to={`/chat/${encodeURIComponent(f?.username ?? t.with)}`} viewTransition className={`dm-row press${t.unread ? " new" : ""}`}>
              <Avatar src={f?.avatar} name={f?.username ?? t.with} size={44} />
              <span style={{ minWidth: 0 }}>
                <b>{f?.name || f?.username || t.with}</b>
                <span className="dm-last">{dmPreview(t.last, me)}</span>
              </span>
              <span className="dm-side">
                <span>{agoText(t.last.ts)}</span>
                {t.unread > 0 && <span className="dm-n">{t.unread}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
