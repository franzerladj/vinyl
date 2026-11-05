// Geteiltes Set öffnen: was davon habe ich, was fehlt, wer von meinen Freunden hat es.
// Übernehmen legt ein eigenes Set mit den Tracks an, die man selbst spielen kann.
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { NavBar } from "../components/ui";
import { Cover, Empty, haptic } from "../components/bits";
import { db, type DJSet } from "../lib/db";
import { addWant } from "../lib/sync";
import { toast } from "../lib/store";
import { coverage, decodeSet } from "../../../shared/setShare";

export default function SharedSetPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const shared = useMemo(() => decodeSet(loc.hash.slice(1)), [loc.hash]);
  const [busy, setBusy] = useState(false);

  const local = useLiveQuery(async () => {
    const [coll, wants, friendColl] = await Promise.all([db.collection.toArray(), db.wants.toArray(), db.friendItems.where("kind").equals("coll").toArray().catch(() => [])]);
    const owned = new Set(coll.map((c) => c.releaseId));
    const wanted = new Set(wants.map((w) => w.releaseId));
    const friendsHave = new Map<number, string[]>();
    for (const f of friendColl) friendsHave.set(f.releaseId, [...(friendsHave.get(f.releaseId) ?? []), f.username]);
    const rels = new Map((await db.releases.bulkGet([...owned].filter((id) => shared?.tracks.some((t) => t.releaseId === id) || shared?.crate.some((c) => c.releaseId === id)))).filter(Boolean).map((r) => [r!.id, r!]));
    return { owned, wanted, friendsHave, rels };
  }, [shared]);

  if (!shared)
    return (
      <>
        <NavBar title="Geteiltes Set" backTo="/sets" backLabel="Sets" />
        <div className="page">
          <Empty title="Link nicht lesbar">Der Link ist unvollständig oder kaputt. Lass ihn dir noch einmal schicken.</Empty>
        </div>
      </>
    );

  const cov = local ? coverage(shared, local.owned) : null;
  const missingRecords = (cov?.missing ?? []).map((rid) => ({ rid, ...(shared.records[rid] ?? shared.crate.find((c) => c.releaseId === rid) ?? { artist: "", title: String(rid) }) }));

  async function adopt() {
    if (!local) return;
    setBusy(true);
    try {
      const trackIds: string[] = [];
      const mixNotes: Record<string, string> = {};
      for (const t of shared!.tracks) {
        if (!local.owned.has(t.releaseId)) continue;
        // Eigene Track-ID suchen: erst über die Position, sonst über den Titel
        let mine = await db.tracks.get(`${t.releaseId}:${t.position}`);
        if (!mine) mine = (await db.tracks.where("releaseId").equals(t.releaseId).toArray()).find((x) => x.title.toLowerCase() === t.title.toLowerCase());
        const tid = mine?.id ?? `${t.releaseId}:${t.position}`;
        if (trackIds.includes(tid)) continue;
        trackIds.push(tid);
        if (t.note) mixNotes[tid] = t.note;
      }
      const crateIds = [...new Set([...shared!.tracks.map((t) => t.releaseId), ...shared!.crate.map((c) => c.releaseId)])].filter((r) => local.owned.has(r));
      const set: DJSet = {
        name: shared!.by ? `${shared!.name} (von ${shared!.by})` : shared!.name,
        date: shared!.date,
        venue: shared!.venue,
        curve: shared!.curve ?? "journey",
        trackIds,
        crateIds,
        mixNotes,
        createdAt: Date.now(),
      };
      const id = await db.sets.add(set);
      haptic(12);
      toast(`Set übernommen: ${trackIds.length} von ${shared!.tracks.length} Tracks`);
      nav(`/sets/${id}`, { viewTransition: true, replace: true });
    } finally {
      setBusy(false);
    }
  }

  async function want(rid: number) {
    try {
      await addWant(rid);
      haptic(8);
      toast("Auf die Wantlist gesetzt");
    } catch {
      toast("Das hat nicht geklappt. Später noch einmal versuchen.");
    }
  }

  return (
    <>
      <NavBar title="Geteiltes Set" backTo="/sets" backLabel="Sets" />
      <div className="page stack">
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ margin: 0 }}>{shared.name}</h1>
          <span className="sub">{[shared.by && `von ${shared.by}`, shared.date && new Date(shared.date).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }), shared.venue].filter(Boolean).join(" · ")}</span>
        </div>

        {cov && (
          <div className="card stack" style={{ gap: 10 }}>
            <div className="shared-meter" aria-hidden>
              <span style={{ width: `${cov.records ? (cov.have / cov.records) * 100 : 0}%` }} />
            </div>
            <b>
              Du hast {cov.have} von {cov.records} Platten
            </b>
            <span className="sub">
              {cov.playable === shared.tracks.length
                ? "Du kannst das ganze Set selbst spielen."
                : cov.playable
                  ? `${cov.playable} der ${shared.tracks.length} Tracks kannst du selbst spielen. Für ein B2B bringt ${shared.by ?? "dein Freund"} den Rest mit.`
                  : "Keine dieser Platten ist in deiner Sammlung. Ideal zum Digging oder für ein B2B."}
            </span>
            <button className="btn primary" disabled={busy || !cov.have} onClick={adopt}>
              {busy ? "Wird übernommen …" : "Als eigenes Set übernehmen"}
            </button>
          </div>
        )}

        <h2 style={{ marginBottom: 0 }}>Tracklist</h2>
        <div className="list">
          {shared.tracks.map((t, i) => {
            const have = local?.owned.has(t.releaseId);
            const r = local?.rels.get(t.releaseId);
            return (
              <div key={`${t.releaseId}:${t.position}:${i}`} className="rec shared-track">
                <span className="shared-num">{i + 1}</span>
                <Cover src={r?.thumb} />
                <div className="rec-main">
                  <div className="rec-title">{t.title}</div>
                  <div className="rec-artist">
                    {t.artist} · {t.position}
                  </div>
                  <div className="rec-meta">
                    {t.bpm ? <span>{Math.round(t.bpm)} BPM</span> : null}
                    {t.key ? <span>{t.key}</span> : null}
                    {t.note ? <span>„{t.note}“</span> : null}
                  </div>
                </div>
                <span className={`badge ${have ? "ok" : ""}`}>{have ? "hast du" : "fehlt"}</span>
              </div>
            );
          })}
        </div>

        {missingRecords.length > 0 && (
          <>
            <h2 style={{ marginBottom: 0 }}>Fehlt dir ({missingRecords.length})</h2>
            <div className="list">
              {missingRecords.map((m) => {
                const friends = local?.friendsHave.get(m.rid) ?? [];
                const wanted = local?.wanted.has(m.rid);
                return (
                  <div key={m.rid} className="rec">
                    <Link to={`/release/${m.rid}`} viewTransition className="rec-main" style={{ color: "inherit" }}>
                      <div className="rec-title">{m.title}</div>
                      <div className="rec-artist">{m.artist}</div>
                      {friends.length > 0 && <div className="rec-meta"><span>hat {friends.slice(0, 2).join(", ")}{friends.length > 2 ? ` und ${friends.length - 2} weitere` : ""}</span></div>}
                    </Link>
                    {wanted ? (
                      <span className="badge">auf Wantlist</span>
                    ) : (
                      <button className="btn small" onClick={() => want(m.rid)}>
                        Wantlist
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
