import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { addFriend, collectionUrl, friendMatches, inviteLink, messageUrl, profileUrl, removeFriend, syncFriend, type FriendMatch } from "../lib/friends";
import { toast, useStore } from "../lib/store";
import { Empty, haptic, RecordRow, Seg, SkeletonRows, useDebounced } from "../components/bits";
import { IconMore, IconPlus, IconSearch, IconShare, IconSync, IconTrash, IconUser } from "../components/icons";
import { MenuSheet, NavBar } from "../components/ui";

function Avatar({ src, name, size = 52 }: { src?: string; name: string; size?: number }) {
  const [ok, setOk] = useState(true);
  return src && ok ? (
    <img src={src} alt="" onError={() => setOk(false)} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--surface-2)" }} />
  ) : (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function Friends() {
  const { username } = useParams();
  return username ? <FriendDetail u={username} /> : <FriendList />;
}

function FriendList() {
  const [params, setParams] = useSearchParams();
  const invited = params.get("add");
  const me = useStore((s) => s.me);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const friends = useLiveQuery(async () => {
    const list = await db.friends.orderBy("addedAt").reverse().toArray();
    const matches = await Promise.all(list.map((f) => friendMatches(f.username)));
    return list.map((f, i) => ({ f, m: matches[i] }));
  });

  const add = async (u: string) => {
    setBusy(true);
    try {
      const f = await addFriend(u);
      haptic(12);
      toast(`${f.username} hinzugefügt`);
      setName("");
      setParams({}, { replace: true });
      void syncFriend(f.username).catch((e) => toast(e.message));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = inviteLink();
    const text = `Lass uns auf Crate befreunden, dann siehst du meine Platten und ich deine. Mein Discogs-Name: ${me?.username}`;
    if (navigator.share) await navigator.share({ title: "Crate", text, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(`${text} ${url}`).then(() => toast("Einladung kopiert"));
  };

  return (
    <>
      <NavBar title="Freunde" titleOnScroll backLabel="Zurück" />
      <div className="page-head" style={{ paddingTop: 0 }}>
        <div>
          <h1>Freunde</h1>
          <div className="sub">Sammlungen und Wantlists deiner Kumpels</div>
        </div>
      </div>
      <div className="page stack">
        {invited && invited.toLowerCase() !== me?.username?.toLowerCase() && !friends?.some((x) => x.f.username.toLowerCase() === invited.toLowerCase()) && (
          <div className="card row" style={{ background: "var(--accent-soft)", animation: "pop .5s var(--spring) both" }}>
            <Avatar name={invited} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{invited}</b>
              <div className="sub">hat dich eingeladen</div>
            </div>
            <button className="btn small primary" disabled={busy} onClick={() => add(invited)}>
              Hinzufügen
            </button>
          </div>
        )}

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add(name);
          }}
        >
          <div className="search-bar" style={{ flex: 1 }}>
            <IconUser />
            <input className="input" placeholder="Discogs-Name oder Profil-Link" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="none" autoCorrect="off" />
          </div>
          <button className="btn primary" disabled={busy || !name.trim()}>
            <IconPlus />
          </button>
        </form>

        {friends?.length ? (
          <div className="list rise">
            {friends.map(({ f, m }) => (
              <Link key={f.username} to={`/friends/${encodeURIComponent(f.username)}`} viewTransition className="rec">
                <Avatar src={f.avatar} name={f.username} />
                <div className="rec-main">
                  <div className="rec-title">{f.name || f.username}</div>
                  <div className="rec-artist">
                    {f.name ? `${f.username}` : ""}
                    {f.location ? `${f.name ? " · " : ""}${f.location}` : ""}
                  </div>
                  <div className="rec-meta">
                    <span>{f.collectionPrivate ? "Sammlung privat" : f.numCollection != null ? `${f.numCollection} Platten` : f.lastSync ? "" : "wird geladen …"}</span>
                    <span>{f.wantsPrivate ? "Wantlist privat" : f.numWantlist != null ? `${f.numWantlist} Wants` : ""}</span>
                  </div>
                </div>
                <div className="rec-side stack" style={{ gap: 4, alignItems: "flex-end" }}>
                  {m.hasYourWants.length > 0 && <span className="badge ok">hat {m.hasYourWants.length} deiner Wants</span>}
                  {m.wantsYours.length > 0 && <span className="badge accent">sucht {m.wantsYours.length} von dir</span>}
                </div>
              </Link>
            ))}
          </div>
        ) : friends ? (
          <Empty title="Noch keine Freunde" action={<button className="btn primary" onClick={share}><IconShare /> Kumpels einladen</button>}>
            Füge Freunde über ihren Discogs-Namen hinzu. Du siehst ihre Sammlung, ihre Wantlist und vor allem, wer welche deiner Wants im Regal stehen hat.
          </Empty>
        ) : (
          <SkeletonRows n={3} />
        )}

        {friends && friends.length > 0 && (
          <button className="btn block tinted" onClick={share}>
            <IconShare /> Kumpels einladen
          </button>
        )}

        <div className="card stack" style={{ gap: 6 }}>
          <b>Damit Freunde deine Platten sehen</b>
          <span className="sub">
            Sammlung und Wantlist müssen bei Discogs öffentlich sein: Einstellungen → Privatsphäre → „Sammlung öffentlich anzeigen“ bzw. Wantlist. BPM, Keys und Sets bleiben auf deinem Handy und sind für niemanden sichtbar.
          </span>
          <a className="btn small ghost" style={{ alignSelf: "flex-start", paddingLeft: 0 }} href="https://www.discogs.com/settings/privacy" target="_blank" rel="noreferrer">
            Privatsphäre bei Discogs öffnen ↗
          </a>
        </div>
      </div>
    </>
  );
}

type Tab = "hasYourWants" | "wantsYours" | "coll" | "want" | "shared";

function FriendDetail({ u }: { u: string }) {
  const nav = useNavigate();
  const jobs = useStore((s) => s.jobs);
  const [tab, setTab] = useState<Tab>("hasYourWants");
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.toLowerCase(), 180);
  const f = useLiveQuery(() => db.friends.get(u), [u]);
  const data = useLiveQuery(async () => {
    const [m, items] = await Promise.all([friendMatches(u), db.friendItems.where("username").equals(u).toArray()]);
    const ids = [...new Set(items.map((i) => i.releaseId))];
    const rels = new Map((await db.releases.bulkGet(ids)).filter(Boolean).map((r) => [r!.id, r!]));
    return { m, items, rels };
  }, [u]);
  const syncing = Boolean(jobs[`friend-${u}`]);

  useEffect(() => {
    if (f && !f.lastSync && !syncing) void syncFriend(u).catch((e) => toast(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.username]);

  const m: FriendMatch = data?.m ?? { hasYourWants: [], wantsYours: [], shared: [], bothWant: [] };
  const ids = useMemo(() => {
    if (!data) return [];
    const byKind = (k: "coll" | "want") => data.items.filter((i) => i.kind === k).map((i) => i.releaseId);
    const base = tab === "coll" ? byKind("coll") : tab === "want" ? byKind("want") : tab === "shared" ? m.shared : tab === "wantsYours" ? m.wantsYours : m.hasYourWants;
    return base.filter((id) => {
      if (!dq) return true;
      const r = data.rels.get(id);
      return r && `${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${r.styles.join(" ")}`.toLowerCase().includes(dq);
    });
  }, [data, tab, dq, m]);

  const counts: Record<Tab, number> = {
    hasYourWants: m.hasYourWants.length,
    wantsYours: m.wantsYours.length,
    coll: data?.items.filter((i) => i.kind === "coll").length ?? 0,
    want: data?.items.filter((i) => i.kind === "want").length ?? 0,
    shared: m.shared.length,
  };
  const hint: Record<Tab, string> = {
    hasYourWants: `Diese Platten stehen bei ${u} im Regal und auf deiner Wantlist. Frag doch mal, ob tauschen oder verkaufen drin ist.`,
    wantsYours: `Diese Platten sucht ${u}, und du hast sie. Gute Tauschbasis.`,
    coll: "",
    want: "",
    shared: "Diese Platten habt ihr beide.",
  };

  if (f === undefined) return <SkeletonRows />;
  if (f === null) return <Empty title="Freund nicht gefunden" />;

  return (
    <>
      <NavBar
        title={f.name || f.username}
        titleOnScroll
        backTo="/friends"
        backLabel="Freunde"
        right={
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Mehr">
            <IconMore />
          </button>
        }
      />
      <div className="page stack" style={{ alignItems: "center", textAlign: "center", paddingTop: 4 }}>
        <Avatar src={f.avatar} name={f.username} size={92} />
        <div>
          <h1 style={{ margin: 0, font: "800 26px/1.15 var(--font-display)", letterSpacing: "-0.03em" }}>{f.name || f.username}</h1>
          <div className="sub">{[f.name ? f.username : null, f.location].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn small primary" href={messageUrl(u)} target="_blank" rel="noreferrer">
            Nachricht
          </a>
          <a className="btn small" href={collectionUrl(u)} target="_blank" rel="noreferrer">
            Auf Discogs ↗
          </a>
        </div>
      </div>

      <div className="page stack" style={{ paddingTop: 0 }}>
        <div className="grid2">
          <button className={`stat press ${tab === "hasYourWants" ? "on" : ""}`} onClick={() => setTab("hasYourWants")} style={{ textAlign: "left", border: 0, outline: tab === "hasYourWants" ? "2px solid var(--ok)" : undefined }}>
            <b style={{ color: counts.hasYourWants ? "var(--ok)" : undefined }}>{counts.hasYourWants}</b>
            <span>hat deine Wants</span>
          </button>
          <button className={`stat press ${tab === "wantsYours" ? "on" : ""}`} onClick={() => setTab("wantsYours")} style={{ textAlign: "left", border: 0, outline: tab === "wantsYours" ? "2px solid var(--accent)" : undefined }}>
            <b style={{ color: counts.wantsYours ? "var(--accent)" : undefined }}>{counts.wantsYours}</b>
            <span>sucht deine Platten</span>
          </button>
        </div>
        <Seg
          value={tab}
          options={[
            ["coll", `Sammlung${counts.coll ? ` ${counts.coll}` : ""}`],
            ["want", `Wants${counts.want ? ` ${counts.want}` : ""}`],
            ["shared", `Gemeinsam ${counts.shared}`],
          ]}
          onChange={setTab}
        />
        {((tab === "coll" && !f.collectionPrivate) || (tab === "want" && !f.wantsPrivate)) && (
          <div className="search-bar">
            <IconSearch />
            <input className="input" type="search" placeholder={tab === "coll" ? `In der Sammlung von ${u} suchen …` : `In der Wantlist von ${u} suchen …`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        {hint[tab] && ids.length > 0 && <p className="sub" style={{ margin: "0 2px" }}>{hint[tab]}</p>}

        {syncing && !data?.items.length ? (
          <SkeletonRows n={5} />
        ) : (tab === "coll" && f.collectionPrivate) || (tab === "want" && f.wantsPrivate) ? (
          <Empty title={tab === "coll" ? "Sammlung ist privat" : "Wantlist ist privat"}>
            {u} muss sie bei Discogs unter Einstellungen → Privatsphäre öffentlich machen. Schick ihm doch den Link aus der Freunde-Übersicht.
          </Empty>
        ) : ids.length ? (
          <div className="list">
            {ids.slice(0, 500).map((id) => {
              const r = data?.rels.get(id);
              return r ? <RecordRow key={id} r={r} /> : null;
            })}
          </div>
        ) : (
          <Empty title={tab === "hasYourWants" ? "Keine Treffer" : tab === "wantsYours" ? "Nichts dabei" : "Nichts gefunden"}>
            {tab === "hasYourWants" ? `${u} hat aktuell keine Platte von deiner Wantlist.` : tab === "wantsYours" ? `${u} sucht gerade nichts, was du hast.` : dq ? "Anders suchen." : ""}
          </Empty>
        )}
        {f.lastSync && <p className="tiny" style={{ textAlign: "center" }}>Stand {new Date(f.lastSync).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</p>}
      </div>

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={f.username}
        items={[
          { label: "Jetzt aktualisieren", icon: <IconSync />, onClick: () => syncFriend(u).then(() => toast("Aktualisiert"), (e) => toast(e.message)), disabled: syncing },
          { label: "Profil auf Discogs", icon: <IconUser />, onClick: () => window.open(profileUrl(u), "_blank") },
          {
            label: "Freund entfernen",
            icon: <IconTrash />,
            danger: true,
            onClick: async () => {
              if (!confirm(`${u} aus deinen Freunden entfernen?`)) return;
              await removeFriend(u);
              nav("/friends", { viewTransition: true });
            },
          },
        ]}
      />
    </>
  );
}
