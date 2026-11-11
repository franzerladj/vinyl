// Ordner-Leiste, Ordner verwalten und Platten einsortieren (Sammlung und Wantlist)
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { createFolder, deleteFolder, folderIdFor, moveToFolder, renameFolder, runFolderJob, setWantFolder, useFolders, useWantFolderNames } from "../lib/folders";
import { ask, toast } from "../lib/store";
import { matchesQuery } from "../../../shared/textSearch";
import { cleanFolderName, NO_FOLDER, sameFolder, wantFolderOf } from "../../../shared/folders";
import { Cover, haptic, Sheet } from "./bits";
import { IconCheck, IconPlus } from "./icons";

export type FolderKind = "coll" | "want";
/** Auswahl in der Leiste: "" = alle, "-" = ohne Ordner, sonst der Ordnername */
export type FolderPick = string;

interface Rec {
  id: number;
  title: string;
  artist: string;
  thumb: string;
  styles: string[];
  folder: string | null;
}

/** Platten einer Liste mit ihrem Ordner (Name). Sammlung: Ordner des ersten Exemplars. */
export function useFolderRecords(kind: FolderKind): Rec[] | undefined {
  const folders = useFolders();
  return useLiveQuery(async () => {
    const byId = new Map(folders.map((f) => [f.id, f.name]));
    const rows = kind === "coll" ? (await db.collection.toArray()).map((c) => ({ id: c.releaseId, folder: byId.get(c.folderId) ?? null })) : (await db.wants.toArray()).map((w) => ({ id: w.releaseId, folder: wantFolderOf(w.notes) }));
    const seen = new Map<number, string | null>();
    for (const r of rows) if (!seen.has(r.id) || (!seen.get(r.id) && r.folder)) seen.set(r.id, r.folder);
    const ids = [...seen.keys()];
    const rels = await db.releases.bulkGet(ids);
    return ids.flatMap((id, i) => {
      const r = rels[i];
      return r ? [{ id, title: r.title, artist: r.artist, thumb: r.thumb, styles: r.styles, folder: seen.get(id) ?? null }] : [];
    });
  }, [kind, folders]);
}

/** Ordnernamen samt Anzahl für eine Liste */
export function useFolderTabs(kind: FolderKind, recs: Rec[] | undefined) {
  const coll = useFolders().map((f) => f.name);
  const want = useWantFolderNames();
  const names = kind === "coll" ? coll : want;
  return useMemo(() => {
    const count = (n: string | null) => recs?.filter((r) => (n ? sameFolder(r.folder, n) : !r.folder)).length ?? 0;
    return { names, tabs: names.map((n) => ({ name: n, count: count(n) })), none: count(null), all: recs?.length ?? 0 };
  }, [names, recs]);
}

export const inPick = (folder: string | null | undefined, pick: FolderPick) => (!pick ? true : pick === "-" ? !folder : sameFolder(folder, pick));

/** Waagrechte Ordner-Leiste über der Liste. Ohne eigene Ordner nur ein dezenter Knopf. */
export function FolderBar({ kind, recs, value, onChange, onManage }: { kind: FolderKind; recs: Rec[] | undefined; value: FolderPick; onChange: (v: FolderPick) => void; onManage: () => void }) {
  const { tabs, none, all } = useFolderTabs(kind, recs);
  if (!tabs.length) return null;
  const tab = (key: FolderPick, label: string, n: number) => (
    <button key={key || "all"} className={`folder-tab press${value === key || (key && sameFolder(value, key)) ? " on" : ""}`} onClick={() => (haptic(5), onChange(key))} aria-pressed={value === key}>
      {label} <span className="folder-n">{n}</span>
    </button>
  );
  return (
    <div className="folder-tabs" role="tablist" aria-label="Ordner">
      {tab("", "Alle", all)}
      {tabs.filter((t) => t.count > 0 || sameFolder(value, t.name)).map((t) => tab(t.name, t.name, t.count))}
      {none > 0 && none < all && tab("-", "Ohne Ordner", none)}
      <button className="folder-tab ghost press" onClick={onManage} aria-label="Ordner verwalten">
        Ordner …
      </button>
    </div>
  );
}

/** Ordner verwalten: anlegen, umbenennen, löschen, Platten einsortieren */
export function FolderManager({ kind, open, onClose, recs, startWith, onShow }: { kind: FolderKind; open: boolean; onClose: () => void; recs: Rec[] | undefined; startWith?: string | null; onShow?: (name: string) => void }) {
  const folders = useFolders();
  const { tabs, none } = useFolderTabs(kind, recs);
  const [editing, setEditing] = useState<string | null>(startWith ?? null);
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    setEditing(null);
    onClose();
  };
  const add = async () => {
    const name = cleanFolderName(fresh);
    if (!name) return;
    setBusy(true);
    try {
      const f = await createFolder(name);
      setFresh("");
      setEditing(f.name);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const label = kind === "coll" ? "Sammlung" : "Wantlist";
  return (
    <Sheet open={open} onClose={close}>
      {editing ? (
        <FolderSorter key={editing} kind={kind} name={editing} recs={recs ?? []} folderId={folders.find((f) => sameFolder(f.name, editing))?.id} onBack={() => setEditing(null)} onSaved={(n) => (close(), onShow?.(n))} onRenamed={setEditing} onDeleted={() => setEditing(null)} />
      ) : (
        <div className="stack">
          <div className="sheet-title">
            <h3>Ordner</h3>
            <button className="text-btn" onClick={close}>
              Fertig
            </button>
          </div>
          <p className="sub" style={{ margin: 0 }}>
            Trenn zum Beispiel Platten zum Auflegen von denen zum Hören. Die Ordner gelten für Sammlung und Wantlist und stehen auch bei Discogs. Kaufst du ein Want, landet die Platte im selben Ordner.
          </p>
          {tabs.length > 0 && (
            <div className="option-list">
              {tabs.map((t) => (
                <button key={t.name} className="option" onClick={() => setEditing(t.name)}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                  <span className="sub">{t.count}</span>
                  <span className="chev">›</span>
                </button>
              ))}
              {none > 0 && (
                <div className="option" style={{ cursor: "default" }}>
                  <span style={{ flex: 1 }} className="sub">
                    Ohne Ordner
                  </span>
                  <span className="sub">{none}</span>
                </div>
              )}
            </div>
          )}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input className="input" placeholder={tabs.length ? "Neuer Ordner" : "Erster Ordner, z. B. Auflegen"} value={fresh} onChange={(e) => setFresh(e.target.value)} maxLength={40} enterKeyHint="done" />
            <button className="btn primary" disabled={!cleanFolderName(fresh) || busy}>
              Anlegen
            </button>
          </form>
          {!tabs.length && (
            <div className="chips">
              {["Auflegen", "Hören", "Metal", "Punk"].map((s) => (
                <button key={s} className="chip" onClick={() => setFresh(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <p className="tiny" style={{ margin: 0 }}>
            Tipp: Ein Ordner antippen und Platten aus der {label} einsortieren, auch alle eines Styles auf einmal.
          </p>
        </div>
      )}
    </Sheet>
  );
}

/** Einen Ordner bearbeiten: Name, Platten an- und abhaken, löschen */
function FolderSorter({ kind, name, recs, folderId, onBack, onSaved, onRenamed, onDeleted }: { kind: FolderKind; name: string; recs: Rec[]; folderId?: number; onBack: () => void; onSaved: (n: string) => void; onRenamed: (n: string) => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(name);
  const [q, setQ] = useState("");
  const [style, setStyle] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const initial = useMemo(() => new Set(recs.filter((r) => sameFolder(r.folder, name)).map((r) => r.id)), [recs, name]);
  const [sel, setSel] = useState<Set<number>>(initial);
  const styles = useMemo(() => {
    const c = new Map<string, number>();
    recs.forEach((r) => r.styles.forEach((s) => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([s]) => s);
  }, [recs]);
  const list = useMemo(
    () =>
      recs
        .filter((r) => (!style || r.styles.includes(style)) && (!onlyFree || !r.folder || sameFolder(r.folder, name)) && (!q.trim() || matchesQuery(`${r.artist} ${r.title} ${r.styles.join(" ")}`, q)))
        .sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)) || a.artist.localeCompare(b.artist, "de")),
    // Reihenfolge nur beim Filtern neu, nicht bei jedem Haken (sonst springt die Liste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recs, style, q, onlyFree, name],
  );
  const added = [...sel].filter((id) => !initial.has(id));
  const removed = [...initial].filter((id) => !sel.has(id));
  const changes = added.length + removed.length;
  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = list.length > 0 && list.every((r) => sel.has(r.id));
  const markAll = () =>
    setSel((s) => {
      const n = new Set(s);
      list.forEach((r) => (allShown ? n.delete(r.id) : n.add(r.id)));
      return n;
    });

  const apply = () => {
    if (!changes) return onBack();
    const target = name;
    runFolderJob(`${changes} ${changes === 1 ? "Platte wird" : "Platten werden"} einsortiert`, async () => {
      if (kind === "coll") {
        const id = folderId ?? (await folderIdFor(target));
        return (await moveToFolder(added, id)) + (await moveToFolder(removed, NO_FOLDER));
      }
      return (await setWantFolder(added, target)) + (await setWantFolder(removed, null));
    });
    onSaved(target);
  };
  const rename = async () => {
    const n = cleanFolderName(title);
    if (!n || n === name) return setTitle(name);
    try {
      if (folderId) await renameFolder(folderId, n);
      else await setWantFolder([...initial], n);
      onRenamed(n);
    } catch (e) {
      toast((e as Error).message);
      setTitle(name);
    }
  };
  const remove = async () => {
    if (!(await ask({ title: `Ordner „${name}“ löschen?`, body: "Die Platten bleiben in Sammlung und Wantlist, nur ohne Ordner.", ok: "Löschen", danger: true }))) return;
    runFolderJob("Ordner wird gelöscht", async () => {
      if (folderId) await deleteFolder(folderId);
      else await setWantFolder([...initial], null);
      toast(`Ordner „${name}“ gelöscht`);
      return 0;
    });
    onDeleted();
  };

  return (
    <div className="stack folder-sorter">
      <div className="row">
        <button className="text-btn" onClick={onBack} style={{ paddingLeft: 0 }}>
          ‹ Ordner
        </button>
        <span className="spacer" />
        <button className="text-btn" onClick={apply} style={{ fontWeight: 700 }}>
          {changes ? `Sichern (${changes})` : "Fertig"}
        </button>
      </div>
      <input className="input folder-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename} maxLength={40} aria-label="Name des Ordners" enterKeyHint="done" />
      <div className="sub">
        {sel.size} {sel.size === 1 ? "Platte" : "Platten"} im Ordner. Antippen zum Einsortieren oder Rausnehmen.
      </div>
      <input className="input" type="search" placeholder="Artist, Titel, Style …" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips chips-scroll">
        <button className={`chip ${!style ? "on" : ""}`} onClick={() => setStyle("")}>
          Alle Styles
        </button>
        {styles.map((s) => (
          <button key={s} className={`chip ${style === s ? "on" : ""}`} onClick={() => setStyle(style === s ? "" : s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className={`chip ${onlyFree ? "on" : ""}`} onClick={() => setOnlyFree(!onlyFree)}>
          Nur ohne Ordner
        </button>
        <span className="spacer" />
        {list.length > 0 && (
          <button className="text-btn" onClick={markAll}>
            {allShown ? "Keine" : `Alle ${list.length} markieren`}
          </button>
        )}
      </div>
      <div className="list">
        {list.slice(0, 200).map((r) => {
          const on = sel.has(r.id);
          const elsewhere = !on && r.folder && !sameFolder(r.folder, name) ? r.folder : null;
          return (
            <button key={r.id} className={`pick-rec press${on ? " on" : ""}`} onClick={() => (haptic(6), toggle(r.id))} aria-pressed={on}>
              <Cover src={r.thumb} />
              <span className="pick-rec-main">
                <b>{r.title}</b>
                <span>{[r.artist, elsewhere ? `in „${elsewhere}“` : r.styles[0]].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`pick-check${on ? " on" : ""}`}>{on ? <IconCheck /> : <IconPlus />}</span>
            </button>
          );
        })}
        {list.length > 200 && <div className="tiny" style={{ padding: 8 }}>Weitere {list.length - 200}: bitte suchen oder nach Style filtern.</div>}
        {!list.length && <div className="sub" style={{ padding: 8 }}>Nichts gefunden.</div>}
      </div>
      <button className="btn ghost" style={{ color: "var(--bad)" }} onClick={remove}>
        Ordner löschen
      </button>
    </div>
  );
}

/** Ordner für eine einzelne Platte wählen (Platten-Seite) */
export function FolderChooser({ open, onClose, current, kind, onPick }: { open: boolean; onClose: () => void; current: string | null; kind: FolderKind; onPick: (name: string | null) => void }) {
  const coll = useFolders().map((f) => f.name);
  const want = useWantFolderNames();
  const names = kind === "coll" ? coll : [...new Set([...coll, ...want])];
  const [fresh, setFresh] = useState("");
  const pick = (n: string | null) => {
    haptic(5);
    onClose();
    if (!sameFolder(n, current) && (n || current)) onPick(n);
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-title">
        <h3>In welchen Ordner?</h3>
      </div>
      <div className="option-list">
        {names.map((n) => (
          <button key={n} className="option" onClick={() => pick(n)}>
            <span style={{ flex: 1 }}>{n}</span>
            {sameFolder(n, current) && <span className="opt-check"><IconCheck /></span>}
          </button>
        ))}
        <button className="option" onClick={() => pick(null)}>
          <span style={{ flex: 1 }} className="sub">
            Ohne Ordner
          </span>
          {!current && <span className="opt-check"><IconCheck /></span>}
        </button>
      </div>
      <form
        className="row"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          const n = cleanFolderName(fresh);
          if (n) pick(n);
          setFresh("");
        }}
      >
        <input className="input" placeholder="Neuer Ordner" value={fresh} onChange={(e) => setFresh(e.target.value)} maxLength={40} enterKeyHint="done" />
        <button className="btn tinted" disabled={!cleanFolderName(fresh)}>
          Anlegen
        </button>
      </form>
    </Sheet>
  );
}
