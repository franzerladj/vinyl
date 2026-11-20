// Unterhaltungen mit Freunden als Liste (auf der Freunde-Seite)
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Avatar, Sheet } from "./bits";
import { db } from "../lib/db";
import { toast, useStore } from "../lib/store";
import { cachedSocial, refreshSocial, requestFriend, respondFriend } from "../lib/social";
import { inviteLink, messageUrl } from "../lib/friends";
import type { ChatAttach } from "../pages/Chat";
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

/**
 * Nachricht oder Leihanfrage an jemanden, mit dem man auf Crate (noch) nicht befreundet ist: statt eines fehlenden
 * Knopfs erklärt ein Blatt, woran es hängt, und bietet den nächsten Schritt an (Anfrage, Annehmen, Einladung, Discogs).
 * Rückmeldung von Franz: Die Knöpfe „Nachricht“ und „Leihen?“ fehlten einfach, solange die Anfrage offen war.
 */
export function useMessageFriend() {
  const nav = useNavigate();
  const [ask, setAsk] = useState<{ user: string; attach?: ChatAttach } | null>(null);
  const open = async (user: string, attach?: ChatAttach) => {
    const s = await cachedSocial();
    if (s.friends.some((x) => same(x, user))) nav(`/chat/${encodeURIComponent(user)}`, { viewTransition: true, state: attach ? { attach } : undefined });
    else setAsk({ user, attach });
  };
  return { open, sheet: <ConnectSheet target={ask} onClose={() => setAsk(null)} /> };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function ConnectSheet({ target, onClose }: { target: { user: string; attach?: ChatAttach } | null; onClose: () => void }) {
  const nav = useNavigate();
  const me = useStore((s) => s.me)?.username ?? "";
  const social = useLiveQuery(() => cachedSocial(), []);
  const [busy, setBusy] = useState(false);
  // Beim Öffnen frisch nachsehen: vielleicht wurde die Anfrage inzwischen angenommen
  useEffect(() => {
    if (target) void refreshSocial();
  }, [target]);
  const u = target?.user ?? "";
  const friends = Boolean(social?.friends.some((x) => same(x, u)));
  const asked = Boolean(social?.out.some((x) => same(x, u)));
  const asksMe = Boolean(social?.in.some((x) => same(x.from, u)));
  const what = target?.attach?.kind === "borrow" ? "Leihanfragen" : "Nachrichten";
  const toChat = () => {
    onClose();
    // Das Blatt hat einen eigenen Verlaufseintrag: erst schließen lassen, dann weiter
    setTimeout(() => nav(`/chat/${encodeURIComponent(u)}`, { viewTransition: true, state: target?.attach ? { attach: target.attach } : undefined }), 350);
  };
  // Inzwischen befreundet (Anfrage wurde gerade angenommen): direkt in die Unterhaltung
  useEffect(() => {
    if (target && friends) toChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, target]);
  const invite = async () => {
    const url = inviteLink();
    const text = `Lass uns auf Crate befreunden, dann können wir uns schreiben und Platten leihen. Mein Discogs-Name: ${me}`;
    if (navigator.share) await navigator.share({ title: "Crate", text, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(`${text} ${url}`).then(() => toast("Einladung kopiert"));
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Das hat nicht geklappt");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={Boolean(target)} onClose={onClose}>
      <div className="stack connect">
        <div className="sheet-title">
          <h3>{asksMe ? `${u} möchte mit dir befreundet sein` : asked ? "Anfrage noch offen" : "Erst befreunden"}</h3>
        </div>
        <p className="sub connect-text">
          {asksMe
            ? `Nimm die Anfrage an, dann gehen ${what} direkt hier.`
            : asked
              ? `${what} gehen auf Crate nur unter Freunden. Deine Anfrage an ${u} ist noch nicht angenommen. Nutzt ${u} Crate noch nicht, schick eine Einladung.`
              : `${what} gehen auf Crate nur unter Freunden. Schick ${u} eine Anfrage. Sobald sie angenommen ist, könnt ihr euch hier schreiben.`}
        </p>
        {asksMe ? (
          <button className="btn primary block" disabled={busy} onClick={() => run(() => respondFriend(u, true).then(() => refreshSocial()))}>
            Anfrage annehmen
          </button>
        ) : asked ? (
          <button className="btn primary block" onClick={invite}>
            Einladung schicken
          </button>
        ) : (
          <button
            className="btn primary block"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await requestFriend(u);
                if (r === "angefragt") toast("Anfrage geschickt");
                await refreshSocial();
              })
            }
          >
            Anfrage schicken
          </button>
        )}
        <a className="btn block" href={messageUrl(u)} target="_blank" rel="noreferrer">
          Solange auf Discogs schreiben
        </a>
      </div>
    </Sheet>
  );
}
