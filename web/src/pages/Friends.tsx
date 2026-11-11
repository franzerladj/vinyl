import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { notifyFriendAdded } from "../lib/push";
import { isDiscoverable, searchPeople, setDiscoverable, type PersonHit } from "../lib/friends";
import { Switch } from "../components/ui";
import { ProfileHeader } from "../components/ProfileCard";
import { ShareCardSheet } from "../components/ShareCard";
import { renderProfileCard } from "../lib/shareCard";
import { getKV } from "../lib/db";
import type { MyProfile } from "../lib/friends";
import { loadMyProfile, loadProfile } from "../lib/profile";
import type { CrateProfile } from "../../../shared/profile";
import { addFriend, collectionUrl, friendFeed, friendMatches, inviteLink, lentRecords, messageUrl, profileUrl, removeFriend, syncFriend, tasteMatch, type FriendMatch } from "../lib/friends";
import { ask, toast, useStore } from "../lib/store";
import { Avatar, Cover, Empty, haptic, RecordRow, Seg, SkeletonRows, useDebounced, DiscogsCredit } from "../components/bits";
import { IconMore, IconPlus, IconSearch, IconShare, IconSync, IconTrash, IconUser } from "../components/icons";
import { matchesQuery } from "../../../shared/textSearch";
import { MenuSheet, NavBar } from "../components/ui";

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
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [visible, setVisible] = useState<boolean | null>(null);
  const [card, setCard] = useState(false);
  const dq = useDebounced(name, 350);
  useEffect(() => {
    void isDiscoverable().then(setVisible);
  }, []);
  useEffect(() => {
    let alive = true;
    setSearching(dq.trim().length >= 2);
    void searchPeople(dq, (h) => alive && setHits(h)).finally(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, [dq]);

  const friends = useLiveQuery(async () => {
    const list = await db.friends.orderBy("addedAt").reverse().toArray();
    const [matches, tastes] = await Promise.all([Promise.all(list.map((f) => friendMatches(f.username))), Promise.all(list.map((f) => tasteMatch(f.username)))]);
    return list.map((f, i) => ({ f, m: matches[i], taste: tastes[i] }));
  });
  const feed = useLiveQuery(() => friendFeed(16));
  const lent = useLiveQuery(async () => {
    const metas = await lentRecords();
    const rels = await db.releases.bulkGet(metas.map((m) => m.releaseId));
    return metas.map((m, i) => ({ m, r: rels[i] })).filter((x) => x.r);
  });

  const add = async (u: string) => {
    setBusy(true);
    try {
      const f = await addFriend(u);
      haptic(12);
      // Der andere bekommt eine Mitteilung, sobald er sie in Crate eingeschaltet hat
      const status = await notifyFriendAdded(f.username);
      toast(
        status === "zugestellt"
          ? `${f.username} hinzugefügt und benachrichtigt`
          : status === "wartet"
            ? `${f.username} hinzugefügt. Die Nachricht kommt an, sobald dort Mitteilungen in Crate an sind.`
            : `${f.username} hinzugefügt`,
      );
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
          <div className="sub">Sammlungen und Wantlists deiner Freunde</div>
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

        {name.trim().length >= 2 && (
          <div className="group people-hits" role="listbox" aria-label="Vorschläge">
            {hits.map((h) => (
              <button key={h.username} className="people-hit press" role="option" aria-selected={false} disabled={busy} onClick={() => add(h.username)}>
                <Avatar src={h.avatar} name={h.username} size={40} />
                <span className="people-main">
                  <b>{h.djName || h.name || h.username}</b>
                  {h.bio && <span className="people-bio">{h.bio}</span>}
                  <small>
                    {[h.djName || h.name ? h.username : null, h.location, h.records ? `${h.records} Platten` : null].filter(Boolean).join(" · ")}
                    {h.source === "crate" ? <em>auf Crate</em> : h.source === "seller" ? <em>Lieblingshändler</em> : <em>Discogs-Profil</em>}
                  </small>
                </span>
                <span className="people-add">
                  <IconPlus />
                </span>
              </button>
            ))}
            {!hits.length && (
              <div className="people-empty sub">
                {searching ? "Suche …" : "Niemand gefunden. Den genauen Discogs-Namen eingeben oder die Einladung schicken."}
              </div>
            )}
          </div>
        )}

        {visible === false && !name && (
          <div className="card row" style={{ gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Für Freunde auffindbar sein</b>
              <div className="sub">Dann finden dich andere Crate-Nutzer über die Suche, mit Name, Ort und Profilbild von Discogs.</div>
            </div>
            <Switch checked={false} label="Für Freunde auffindbar" onChange={() => setDiscoverable(true).then(() => (setVisible(true), toast("Du bist jetzt auffindbar")), (e) => toast(e.message))} />
          </div>
        )}

        {friends?.length ? (
          <div className="list rise">
            {friends.map(({ f, m, taste }) => (
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
                  {taste.score != null && <span className="tiny">Geschmack {taste.score} %</span>}
                </div>
              </Link>
            ))}
          </div>
        ) : friends ? (
          <Empty title="Noch keine Freunde" action={<button className="btn primary" onClick={share}><IconShare /> Freunde einladen</button>}>
            Füge Freunde über ihren Discogs-Namen hinzu. Du siehst ihre Sammlung, ihre Wantlist und vor allem, wer welche deiner Wants im Regal stehen hat.
          </Empty>
        ) : (
          <SkeletonRows n={3} />
        )}

        <div className="row" style={{ gap: 8 }}>
          {friends && friends.length > 0 && (
            <button className="btn tinted" style={{ flex: 1 }} onClick={share}>
              <IconShare /> Freunde einladen
            </button>
          )}
          <button className="btn" style={{ flex: 1 }} onClick={() => setCard(true)}>
            Profil als Story
          </button>
        </div>
        <ShareCardSheet
          open={card}
          onClose={() => setCard(false)}
          title="Dein Profil als Story"
          filename={`crate-${me?.username ?? "profil"}.png`}
          text={`Folg mir auf Crate: ${inviteLink()}`}
          make={async () => {
            const [mine, disc, records] = await Promise.all([loadMyProfile(), getKV<MyProfile | null>("myProfile", null), db.collection.count()]);
            return renderProfileCard({ username: me?.username ?? "", name: disc?.name, avatar: disc?.avatar, location: disc?.location, profile: mine, records, inviteUrl: inviteLink() });
          }}
        />

        {lent && lent.length > 0 && (
          <>
            <h2 style={{ marginBottom: 0 }}>Verliehen</h2>
            <div className="list">
              {lent.map(({ m, r }) => (
                <RecordRow
                  key={m.releaseId}
                  r={r!}
                  side={
                    <div className="stack" style={{ gap: 3, alignItems: "flex-end" }}>
                      <span className="badge accent">an {m.lentTo}</span>
                      {m.lentAt && <span className="tiny">seit {Math.max(1, Math.round((Date.now() - m.lentAt) / 86400000))} Tagen</span>}
                    </div>
                  }
                />
              ))}
            </div>
          </>
        )}

        {feed && feed.length > 0 && (
          <>
            <h2 style={{ marginBottom: 0 }}>Neu bei deinen Freunden</h2>
            <div className="carousel">
              {feed.map(({ item, r, friend }) => (
                <Link key={item.key} to={`/release/${r!.id}`} viewTransition className="press" style={{ position: "relative" }}>
                  <Cover src={r!.cover || r!.thumb} />
                  <span style={{ position: "absolute", top: 8, left: 8, boxShadow: "0 0 0 2px var(--bg)", borderRadius: "50%", display: "grid" }}>
                    <Avatar src={friend!.avatar} name={friend!.username} size={28} />
                  </span>
                  <div className="t">{r!.title}</div>
                  <div className="a">
                    {r!.artist} · {friend!.username}
                  </div>
                </Link>
              ))}
            </div>
          </>
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
        {visible && (
          <div className="card row" style={{ gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Für Freunde auffindbar</b>
              <div className="sub">Andere Crate-Nutzer finden dich über die Suche.</div>
            </div>
            <Switch checked label="Für Freunde auffindbar" onChange={() => setDiscoverable(false).then(() => (setVisible(false), toast("Du bist nicht mehr auffindbar")), (e) => toast(e.message))} />
          </div>
        )}
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
  const [crate, setCrate] = useState<CrateProfile | null | undefined>(undefined);
  useEffect(() => {
    void loadProfile(u).then(setCrate);
  }, [u]);
  const data = useLiveQuery(async () => {
    const [m, items] = await Promise.all([friendMatches(u), db.friendItems.where("username").equals(u).toArray()]);
    const ids = [...new Set(items.map((i) => i.releaseId))];
    const rels = new Map((await db.releases.bulkGet(ids)).filter(Boolean).map((r) => [r!.id, r!]));
    const taste = await tasteMatch(u);
    const lentHere = (await lentRecords()).filter((x) => x.lentTo === u);
    const lentRels = await db.releases.bulkGet(lentHere.map((x) => x.releaseId));
    return { m, items, rels, taste, lent: lentRels.filter(Boolean) };
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
      return r && matchesQuery(`${r.artist} ${r.title} ${r.labels.map((l) => `${l.name} ${l.catno}`).join(" ")} ${r.styles.join(" ")}`, dq);
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
        title={crate?.djName || f.name || f.username}
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
        <ProfileHeader username={f.username} avatar={f.avatar} discogsName={f.name} location={f.location} profile={crate ?? null}>
          {data?.taste.score != null && (
            <div className="sub" style={{ marginTop: 6 }}>
              <b style={{ color: "var(--accent)" }}>{data.taste.score} %</b> Geschmacks-Übereinstimmung{data.taste.topShared.length ? ` · ihr mögt beide ${data.taste.topShared.join(", ")}` : ""}
            </div>
          )}
        </ProfileHeader>
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
        {data && data.lent.length > 0 && (
          <div className="card stack" style={{ gap: 8, background: "var(--accent-soft)" }}>
            <b>Hat von dir geliehen</b>
            <div className="list">
              {data.lent.map((r) => (
                <RecordRow key={r!.id} r={r!} />
              ))}
            </div>
          </div>
        )}
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
        <DiscogsCredit href={`https://www.discogs.com/user/${encodeURIComponent(u)}`} />
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
              if (!(await ask({ title: `${u} entfernen?`, body: "Die Sammlung und Wantlist von " + u + " verschwinden aus deiner Freundesliste.", ok: "Entfernen", danger: true }))) return;
              await removeFriend(u);
              nav("/friends", { viewTransition: true });
            },
          },
        ]}
      />
    </>
  );
}
