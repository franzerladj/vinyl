// Unterhaltung mit einem Freund: Nachrichten, Leihanfrage für eine Platte und die Antwort darauf.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NavBar } from "../components/ui";
import { Avatar, Cover, Empty, haptic, keepParens, useRootClass } from "../components/bits";
import { IconSend, IconX } from "../components/icons";
import { db } from "../lib/db";
import { ask, toast, useStore } from "../lib/store";
import { lendRecord } from "../lib/friends";
import { deleteDm, markThreadRead, openBorrow, refreshThread, sendDm, useThread, type Dm, type DmBody } from "../lib/dm";

/** Platte, die mit in die Nachricht soll (kommt von der Platten-Seite über location.state) */
export interface ChatAttach {
  kind: "borrow" | "text";
  releaseId: number;
  title: string;
  thumb?: string;
}

const dayText = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Gestern";
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};
const timeText = (ts: number) => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export default function Chat() {
  const u = useParams().username ?? "";
  const nav = useNavigate();
  const loc = useLocation();
  const me = (useStore((s) => s.me)?.username ?? "").toLowerCase();
  const messages = useThread(u);
  const friend = useLiveQuery(async () => (await db.friends.toArray()).find((f) => f.username.toLowerCase() === u.toLowerCase()), [u]);
  const [canWrite, setCanWrite] = useState(true);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState<ChatAttach | null>((loc.state as { attach?: ChatAttach } | null)?.attach ?? null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Die Abgleich-Anzeige läge sonst über dem Eingabefeld
  useRootClass("in-chat", true);

  // Laden, als gelesen merken, und solange die Seite offen ist alle paar Sekunden nachsehen
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await refreshThread(u);
      if (!alive) return;
      if (r) setCanWrite(r.friends);
      void markThreadRead(u);
    };
    void load();
    const t = setInterval(load, 7000);
    const onPush = (e: MessageEvent) => (e.data as { type?: string } | null)?.type === "crate-push" && void load();
    const onShow = () => void load();
    navigator.serviceWorker?.addEventListener("message", onPush);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      clearInterval(t);
      navigator.serviceWorker?.removeEventListener("message", onPush);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [u]);

  // Neue Nachricht: ans Ende, aber nur wenn man ohnehin unten war (oder beim ersten Mal)
  const first = useRef(true);
  const lastId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    if (!messages.length) return;
    const doc = document.documentElement;
    const nearEnd = doc.scrollHeight - window.scrollY - window.innerHeight < 260;
    if (first.current || nearEnd) window.scrollTo(0, doc.scrollHeight);
    first.current = false;
  }, [lastId, messages.length]);

  const send = async (body: DmBody) => {
    if (busy) return;
    setBusy(true);
    haptic(8);
    try {
      await sendDm(u, body);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Nicht gesendet");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const t = text.trim();
    if (!t && !attach) return;
    setText("");
    const a = attach;
    setAttach(null);
    if (box.current) box.current.style.height = "";
    void send(a ? { kind: a.kind, text: t || undefined, releaseId: a.releaseId, title: a.title, thumb: a.thumb } : { text: t });
  };
  const answer = async (m: Dm, yes: boolean) => {
    await send({ kind: yes ? "yes" : "no", releaseId: m.releaseId ?? undefined, title: m.title ?? undefined, thumb: m.thumb ?? undefined });
    if (!yes || !m.releaseId) return;
    // Zugesagt: gleich als verliehen merken, dann erinnert Crate später ans Zurückholen
    const mine = await db.collection.where("releaseId").equals(m.releaseId).first();
    if (!mine) return;
    const name = friend?.username ?? u;
    if (await ask({ title: "Als verliehen eintragen?", body: `Crate merkt sich, dass ${m.title ?? "die Platte"} bei ${name} ist, und erinnert dich später daran.`, ok: "Eintragen", cancel: "Nicht jetzt" })) {
      await lendRecord(m.releaseId, name);
      toast(`An ${name} verliehen`);
    }
  };
  const remove = async (m: Dm) => {
    if (m.id > 0 && !(await ask({ title: "Nachricht löschen?", body: "Sie verschwindet bei euch beiden.", ok: "Löschen", danger: true }))) return;
    await deleteDm(u, m).catch(() => toast("Löschen hat nicht geklappt"));
    setOpen(null);
  };

  // Mein letztes Gesendetes: darunter steht „Gelesen“
  const lastMine = useMemo(() => [...messages].reverse().find((m) => m.from === me && m.id > 0), [messages, me]);
  const name = friend?.name || friend?.username || u;

  return (
    <>
      <NavBar
        title={name}
        backLabel="Freunde"
        right={
          <Link to={`/friends/${encodeURIComponent(friend?.username ?? u)}`} viewTransition className="chat-who" aria-label={`Profil von ${name}`}>
            <Avatar src={friend?.avatar} name={friend?.username ?? u} size={32} />
          </Link>
        }
      />
      <div className="page chat">
        {messages.length === 0 && (
          <Empty title={`Schreib ${name}`}>Fragt euch nach Platten, verabredet euch zum Tauschen oder schickt euch einen Fund. Nur ihr zwei seht das.</Empty>
        )}
        <div className="chat-list">
          {messages.map((m, i) => {
            const mine = m.from === me;
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            const record = m.releaseId ? (
              <button className="chat-rec" onClick={() => nav(`/release/${m.releaseId}`, { viewTransition: true })}>
                <Cover src={m.thumb ?? undefined} />
                <span>
                  <small>{m.kind === "borrow" ? "Leihanfrage" : m.kind === "yes" ? "Klar, kannst du haben" : m.kind === "no" ? "Gerade nicht" : "Platte"}</small>
                  <b>{keepParens(m.title)}</b>
                </span>
              </button>
            ) : null;
            return (
              <div key={m.id} className="chat-item">
                {newDay && <div className="chat-day">{dayText(m.ts)}</div>}
                <div className={`chat-row${mine ? " mine" : ""}`}>
                  <div className={`chat-bubble${m.failed ? " failed" : ""}${m.pending ? " pending" : ""}${m.kind !== "text" ? ` is-${m.kind}` : ""}`} onClick={() => setOpen(open === m.id ? null : m.id)}>
                    {record}
                    {m.text ? <p>{m.text}</p> : null}
                  </div>
                </div>
                {openBorrow(messages, m, me) && (
                  <div className="chat-answer">
                    <button className="btn small primary" disabled={busy} onClick={() => answer(m, true)}>
                      Klar, kannst du haben
                    </button>
                    <button className="btn small" disabled={busy} onClick={() => answer(m, false)}>
                      Gerade nicht
                    </button>
                  </div>
                )}
                {(open === m.id || m.failed || (m === lastMine && m.read)) && (
                  <div className={`chat-meta${mine ? " mine" : ""}`}>
                    {m.failed ? <span className="bad">Nicht gesendet</span> : open === m.id ? <span>{timeText(m.ts)}</span> : <span>Gelesen</span>}
                    {mine && (open === m.id || m.failed) && (
                      <button className="chat-del" onClick={() => remove(m)}>
                        {m.failed ? "Verwerfen" : "Löschen"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canWrite ? (
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {attach && (
              <div className="chat-attach">
                <Cover src={attach.thumb} />
                <span>
                  <small>{attach.kind === "borrow" ? "Leihanfrage" : "Platte"}</small>
                  <b>{attach.title}</b>
                </span>
                <button type="button" className="chat-attach-x" aria-label="Platte entfernen" onClick={() => setAttach(null)}>
                  <IconX />
                </button>
              </div>
            )}
            <div className="chat-input">
              <textarea
                ref={box}
                rows={1}
                value={text}
                maxLength={600}
                placeholder={attach?.kind === "borrow" ? "Ein Satz dazu (muss nicht)" : "Nachricht"}
                aria-label="Nachricht"
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  // Am Computer schickt Enter ab, am Handy macht Enter eine neue Zeile
                  if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button type="submit" className="chat-send" aria-label="Senden" disabled={busy || (!text.trim() && !attach)}>
                <IconSend />
              </button>
            </div>
          </form>
        ) : (
          <p className="tiny chat-closed">Ihr seid auf Crate nicht mehr befreundet. Schreiben geht erst wieder, wenn ihr euch neu verbindet.</p>
        )}
      </div>
    </>
  );
}
