import { SwipeArea } from "../components/Pager";
import { Activity, ShareSetsSwitch } from "../components/Buzz";
import { Messages } from "../components/Messages";
import { refreshBuzz } from "../lib/buzz";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Release } from "../lib/db";
import { isDiscoverable, searchPeople, setDiscoverable, type PersonHit } from "../lib/friends";
import { Switch } from "../components/ui";
import { ProfileHeader } from "../components/ProfileCard";
import { ShareCardSheet } from "../components/ShareCard";
import { renderProfileCard } from "../lib/shareCard";
import { getKV } from "../lib/db";
import type { MyProfile } from "../lib/friends";
import { loadMyProfile, loadProfile } from "../lib/profile";
import { profileEmpty, type CrateProfile } from "../../../shared/profile";
import { Hint } from "../components/Welcome";
import { FriendsHome } from "../components/FriendsHome";
import { cachedSocial, refreshSocial, requestFriend, respondFriend, unfriend } from "../lib/social";
import { addFriend, collectionUrl, friendMatches, inviteLink, lentRecords, messageUrl, profileUrl, removeFriend, syncFriend, tasteMatch, type FriendMatch } from "../lib/friends";
import { ask, toast, useStore } from "../lib/store";
import { Avatar, Cover, Empty, haptic, RecordRow, Seg, SkeletonRows, useDebounced, DiscogsCredit } from "../components/bits";
import { IconChat, IconMore, IconPlus, IconSearch, IconShare, IconSync, IconTrash, IconUser } from "../components/icons";
import { matchesQuery } from "../../../shared/textSearch";
import { MenuSheet, NavBar } from "../components/ui";

// Ein Streifen zum Wischen: erst die beiden Kennzahlen, dann die drei Felder des Umschalters
const FRIEND_TABS = ["hasYourWants", "wantsYours", "coll", "want", "shared"] as const;

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
    // Neueste Platten je Freund für die Cover-Leiste
    const covers = await Promise.all(
      list.map(async (f) => {
        const items = (await db.friendItems.where("username").equals(f.username).toArray()).filter((x) => x.kind === "coll").sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 5);
        return ((await db.releases.bulkGet(items.map((x) => x.releaseId))).filter(Boolean) as Release[]).map((r) => r.thumb || r.cover).filter(Boolean) as string[];
      }),
    );
    return list.map((f, i) => ({ f, m: matches[i], taste: tastes[i], covers: covers[i] }));
  });
  const lent = useLiveQuery(async () => {
    const metas = await lentRecords();
    const rels = await db.releases.bulkGet(metas.map((m) => m.releaseId));
    return metas.map((m, i) => ({ m, r: rels[i] })).filter((x) => x.r);
  });

  // Freundschaften: offene Anfragen an dich und von dir
  const social = useLiveQuery(() => cachedSocial(), []);
  // Eigenes Profil: „?“ = noch nicht geladen (dann keinen Hinweis zeigen)
  const myProfile = useLiveQuery(() => getKV<CrateProfile | null | "?">("crateProfile:me", "?"), [], "?" as const);
  useEffect(() => {
    void refreshSocial();
    void refreshBuzz();
    void loadMyProfile();
  }, []);
  const [answering, setAnswering] = useState<string | null>(null);
  const answer = async (from: string, accept: boolean) => {
    setAnswering(from);
    haptic(accept ? 14 : 6);
    try {
      await respondFriend(from, accept);
      toast(accept ? `${from} und du seid jetzt befreundet` : "Anfrage abgelehnt");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setAnswering(null);
    }
  };
  const [adding, setAdding] = useState<string | null>(null);
  const add = async (u: string) => {
    if (busy) return;
    setBusy(true);
    setAdding(u.trim().toLowerCase());
    haptic(8);
    try {
      const f = await addFriend(u);
      haptic(12);
      // Sofort zeigen: die Mitteilung an den anderen läuft im Hintergrund und darf das Hinzufügen nicht aufhalten
      setName("");
      setParams({}, { replace: true });
      // Die Anfrage läuft im Hintergrund und darf das Hinzufügen nicht aufhalten
      toast(`${f.username} hinzugefügt`);
      void requestFriend(f.username).then((status) => {
        if (status === "befreundet") toast(`${f.username} und du seid jetzt befreundet`);
        else if (status === "angefragt") toast(`Anfrage an ${f.username} gesendet`);
      });
      void syncFriend(f.username, true).catch((e) => toast(e.message));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setAdding(null);
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
      <div className="page-head">
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

        {myProfile !== "?" && (!myProfile || profileEmpty(myProfile)) && (
          <Hint id="profile-empty">
            <b>Dein Profil ist noch leer.</b> DJ-Name, Styles, Setup: in einer Minute gemacht, dann sehen deine Freunde, wer du bist.{" "}
            <Link to="/settings/profile" viewTransition>Profil machen</Link>
          </Hint>
        )}

        <Messages />

        <Activity />

        {(social?.in.length ?? 0) > 0 && (
          <div className="group friend-requests">
            <div className="friend-req-head">Anfragen</div>
            {social!.in.map((r) => (
              <div key={r.from} className="friend-req">
                <Avatar name={r.from} size={44} />
                <div className="friend-req-main">
                  <b>{r.from}</b>
                  <span className="sub">möchte mit dir befreundet sein</span>
                </div>
                <button className="btn small" disabled={answering === r.from} onClick={() => answer(r.from, false)}>
                  Ablehnen
                </button>
                <button className="btn small primary" disabled={answering === r.from} onClick={() => answer(r.from, true)}>
                  Annehmen
                </button>
              </div>
            ))}
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
          <button className="btn primary" disabled={busy || !name.trim()} aria-label="Hinzufügen">
            {busy && adding === name.trim().toLowerCase() ? <span className="spinner" /> : <IconPlus />}
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
                <span className="people-add">{adding === h.username.toLowerCase() ? <span className="spinner" /> : <IconPlus />}</span>
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
          <div className="friend-cards rise">
            {friends.map(({ f, m, taste, covers }) => (
              <Link key={f.username} to={`/friends/${encodeURIComponent(f.username)}`} viewTransition className="friend-card press">
                <div className="friend-card-head">
                  <Avatar src={f.avatar} name={f.username} size={44} />
                  <div className="friend-card-who">
                    <b>{f.name || f.username}</b>
                    <span className="sub">
                      {[f.name ? f.username : null, f.location, f.collectionPrivate ? "Sammlung privat" : f.numCollection != null ? `${f.numCollection} Platten` : f.lastSync ? null : "wird geladen …"].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {taste.score != null && <span className="friend-taste">{taste.score} %</span>}
                </div>
                {covers.length > 0 && (
                  <div className="friend-covers">
                    {covers.map((src, i) => (
                      <img key={i} src={src} alt="" loading="lazy" decoding="async" />
                    ))}
                  </div>
                )}
                {(m.hasYourWants.length > 0 || m.wantsYours.length > 0 || social?.out.some((x) => x.toLowerCase() === f.username.toLowerCase())) && (
                  <div className="friend-card-tags">
                    {m.hasYourWants.length > 0 && <span className="wall-tag inline">hat {m.hasYourWants.length} deiner Wants</span>}
                    {m.wantsYours.length > 0 && <span className="badge">sucht {m.wantsYours.length} von dir</span>}
                    {social?.out.some((x) => x.toLowerCase() === f.username.toLowerCase()) && <span className="badge">Anfrage offen</span>}
                  </div>
                )}
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

        {friends && friends.length > 0 && <FriendsHome friends={friends} limit={20} feedOnly />}
        {friends && friends.length > 0 && <ShareSetsSwitch />}

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
  // Nachrichten gehen nur unter Freunden, die sich auf Crate gegenseitig bestätigt haben
  const onCrate = useLiveQuery(async () => (await cachedSocial()).friends.some((x) => x.toLowerCase() === u.toLowerCase()), [u], false);
  const jobs = useStore((s) => s.jobs);
  // Reiter und Suche bleiben, wenn man eine Platte öffnet und zurückkommt (sonst landet man wieder ganz oben)
  const memo = `crate:friend:${u}`;
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(memo) ?? "null") as { tab: Tab; q: string } | null;
    } catch {
      return null;
    }
  })();
  const [tab, setTab] = useState<Tab>(saved?.tab ?? "hasYourWants");
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState(saved?.q ?? "");
  useEffect(() => {
    try {
      sessionStorage.setItem(memo, JSON.stringify({ tab, q }));
    } catch {
      /* egal */
    }
  }, [memo, tab, q]);
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
    if (f && !f.lastSync && !syncing) void syncFriend(u, true).catch((e) => toast(e.message));
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
          {onCrate ? (
            <Link className="btn small primary" to={`/chat/${encodeURIComponent(u)}`} viewTransition>
              <IconChat /> Nachricht
            </Link>
          ) : (
            <a className="btn small primary" href={messageUrl(u)} target="_blank" rel="noreferrer">
              Nachricht auf Discogs
            </a>
          )}
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
        <SwipeArea index={FRIEND_TABS.indexOf(tab)} count={FRIEND_TABS.length} thumbShift={2} onIndex={(i) => setTab(FRIEND_TABS[i])} className="stack">
        {((tab === "coll" && !f.collectionPrivate) || (tab === "want" && !f.wantsPrivate)) && (
          <div className="search-bar">
            <IconSearch />
            <input className="input" type="search" autoCorrect="off" autoCapitalize="none" spellCheck={false} placeholder={tab === "coll" ? `In der Sammlung von ${u} suchen …` : `In der Wantlist von ${u} suchen …`} value={q} onChange={(e) => setQ(e.target.value)} />
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
        </SwipeArea>
        <DiscogsCredit href={`https://www.discogs.com/user/${encodeURIComponent(u)}`} />
        {f.lastSync && <p className="tiny" style={{ textAlign: "center" }}>Stand {new Date(f.lastSync).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</p>}
      </div>

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={f.username}
        items={[
          { label: "Jetzt aktualisieren", icon: <IconSync />, onClick: () => syncFriend(u, true).then(() => toast("Aktualisiert"), (e) => toast(e.message)), disabled: syncing },
          { label: "Profil auf Discogs", icon: <IconUser />, onClick: () => window.open(profileUrl(u), "_blank") },
          {
            label: "Freund entfernen",
            icon: <IconTrash />,
            danger: true,
            onClick: async () => {
              if (!(await ask({ title: `${u} entfernen?`, body: "Die Sammlung und Wantlist von " + u + " verschwinden aus deiner Freundesliste.", ok: "Entfernen", danger: true }))) return;
              await removeFriend(u);
              void unfriend(u);
              nav("/friends", { viewTransition: true });
            },
          },
        ]}
      />
    </>
  );
}
