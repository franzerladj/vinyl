// Wiederverwendbare Bausteine: Navigationsleiste, Sortier-/Filter-Sheets, Abschnittslisten,
// A–Z-Leiste, Schalter, gespeicherter Zustand.
import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { haptic, Sheet } from "./bits";
import { IconBack, IconCheck, IconFilter, IconSort, IconX } from "./icons";

/** useState, der sich den Wert pro Gerät merkt (localStorage) */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`crate:${key}`);
      return raw ? ({ ...(initial as object), ...JSON.parse(raw) } as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T | ((p: T) => T)) =>
    setV((prev) => {
      const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(`crate:${key}`, JSON.stringify(val));
      } catch {
        /* Speicher nicht verfügbar */
      }
      return val;
    });
  return [v, set];
}

/** Kompakte Leiste für Unterseiten: Zurück, Titel, Aktionen */
export function NavBar({ title, backLabel = "Zurück", backTo, right, titleOnScroll }: { title?: string; backLabel?: string; backTo?: string; right?: React.ReactNode; titleOnScroll?: boolean }) {
  const nav = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > (titleOnScroll ? 56 : 4));
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [titleOnScroll]);
  return (
    <div className={`navbar no-print ${scrolled ? "scrolled" : ""}`}>
      <div className="nb-left">
        <button
          className="back-btn"
          onClick={() => {
            // Gibt es einen Eintrag davor, echt zurückgehen (Scroll-Position bleibt erhalten)
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            if (idx > 0) nav(-1);
            else nav(backTo ?? "/", { viewTransition: true, replace: true });
          }}
        >
          <IconBack />
          <span>{backLabel}</span>
        </button>
      </div>
      <div className="nb-title" style={titleOnScroll ? { opacity: scrolled ? 1 : 0, transition: "opacity .2s" } : undefined}>
        {title}
      </div>
      <div className="nb-right">{right}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        haptic(5);
        onChange(!checked);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Sortieren
// ---------------------------------------------------------------------------
export interface SortOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Beschriftung der Richtungen: [absteigend, aufsteigend], z.B. ["Neu – Alt", "Alt – Neu"] */
  dirs: [string, string];
  /** Standardrichtung beim Wechsel auf diese Sortierung */
  defaultDir: "desc" | "asc";
}

export interface SortState {
  id: string;
  dir: "asc" | "desc";
}

export function SortButton({ options, value, onClick }: { options: SortOption[]; value: SortState; onClick: () => void }) {
  const o = options.find((x) => x.id === value.id) ?? options[0];
  return (
    <button className="tool-btn" onClick={onClick} aria-label="Sortierung ändern">
      <IconSort />
      {o.label}
      <span className="sub" style={{ fontSize: 12.5, fontWeight: 500 }}>
        {value.dir === "desc" ? o.dirs[0] : o.dirs[1]}
      </span>
    </button>
  );
}

export function SortSheet({ open, onClose, options, value, onChange }: { open: boolean; onClose: () => void; options: SortOption[]; value: SortState; onChange: (v: SortState) => void }) {
  const cur = options.find((x) => x.id === value.id) ?? options[0];
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-title">
        <h3>Sortieren nach</h3>
        <button className="text-btn" onClick={onClose}>
          Fertig
        </button>
      </div>
      <div className="option-list">
        {options.map((o) => (
          <button
            key={o.id}
            className="option"
            onClick={() => {
              haptic(5);
              onChange({ id: o.id, dir: o.id === value.id ? value.dir : o.defaultDir });
            }}
          >
            {o.icon && <span className="o-ico">{o.icon}</span>}
            {o.label}
            {o.id === value.id && (
              <span className="o-check">
                <IconCheck />
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="eyebrow" style={{ margin: "18px 4px 8px" }}>
        Reihenfolge
      </div>
      <div className="option-list">
        {(["desc", "asc"] as const).map((d, i) => (
          <button key={d} className="option" onClick={() => (haptic(5), onChange({ id: cur.id, dir: d }))}>
            {cur.dirs[i]}
            {value.dir === d && (
              <span className="o-check">
                <IconCheck />
              </span>
            )}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className={`tool-btn ${count ? "on" : ""}`} onClick={onClick} aria-label="Filter">
      <IconFilter />
      Filter
      {count > 0 && <span className="count">{count}</span>}
    </button>
  );
}

export function ActiveChips({ items, onClear }: { items: { key: string; label: string; remove: () => void }[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((i) => (
        <button key={i.key} className="active-chip" onClick={() => (haptic(5), i.remove())} aria-label={`${i.label} entfernen`}>
          {i.label}
          <IconX />
        </button>
      ))}
      {items.length > 1 && (
        <button className="tool-btn" onClick={onClear}>
          Alle löschen
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Abschnittsliste mit klebenden Überschriften und A–Z-Leiste
// ---------------------------------------------------------------------------
export function sectionsOf<T>(items: T[], keyOf: ((x: T) => string) | null): [string, T[]][] {
  if (!keyOf) return [["", items]];
  const out: [string, T[]][] = [];
  for (const it of items) {
    const k = keyOf(it);
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1].push(it);
    else out.push([k, [it]]);
  }
  return out;
}

export function SectionList<T>({ sections, render, stickyTop = 0, className = "list" }: { sections: [string, T[]][]; render: (x: T) => React.ReactNode; stickyTop?: number; className?: string }) {
  return (
    <div style={{ "--sticky-top": `${stickyTop}px` } as React.CSSProperties}>
      {sections.map(([k, items]) => (
        <Fragment key={k || "_"}>
          {k && (
            <div className="section-head" id={`sec-${encodeURIComponent(k)}`} data-section={k}>
              {k} <span className="n">{items.length}</span>
            </div>
          )}
          <div className={className}>{items.map(render)}</div>
        </Fragment>
      ))}
    </div>
  );
}

/** Buchstabenleiste wie in iOS-Kontakten: tippen oder darüberwischen springt zum Abschnitt */
export function AlphaIndex({ letters, offset = 0 }: { letters: string[]; offset?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  if (letters.length < 6) return null;
  const jump = (clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(letters.length - 1, Math.floor(((clientY - r.top) / r.height) * letters.length)));
    const l = letters[i];
    if (l !== active) {
      setActive(l);
      haptic(3);
      const target = document.getElementById(`sec-${encodeURIComponent(l)}`);
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset });
    }
  };
  return (
    <>
      <div
        ref={ref}
        className="alpha-index no-print"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          jump(e.clientY);
        }}
        onPointerMove={(e) => e.buttons && jump(e.clientY)}
        onPointerUp={() => setTimeout(() => setActive(null), 350)}
        aria-hidden="true"
      >
        {letters.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      {active && <div className="alpha-bubble">{active}</div>}
    </>
  );
}

/** Abschnittsschlüssel: erster Buchstabe, Zahlen und Sonderzeichen unter "#" */
export const letterOf = (s: string) => {
  const c = s
    .replace(/^(the|die|der|das|le|la)\s+/i, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

export const sortKey = (s: string) => s.replace(/^(the|die|der|das|le|la)\s+/i, "");

export function MenuSheet({ open, onClose, title, items }: { open: boolean; onClose: () => void; title?: string; items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }[] }) {
  return (
    <Sheet open={open} onClose={onClose}>
      {title && (
        <div className="sheet-title">
          <h3>{title}</h3>
        </div>
      )}
      <div className="option-list">
        {items.map((i) => (
          <button
            key={i.label}
            className={`option ${i.danger ? "danger" : ""}`}
            disabled={i.disabled}
            onClick={() => {
              haptic(5);
              onClose();
              i.onClick();
            }}
          >
            {i.icon && <span className="o-ico">{i.icon}</span>}
            {i.label}
          </button>
        ))}
      </div>
      <button className="btn block lg" style={{ marginTop: 12 }} onClick={onClose}>
        Abbrechen
      </button>
    </Sheet>
  );
}

export function FilterGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="filter-group">
      <div className="eyebrow">{title}</div>
      {hint && <p className="tiny" style={{ margin: "-4px 0 8px" }}>{hint}</p>}
      {children}
    </div>
  );
}

export function ChipGroup({ title, values, selected, onToggle, max = 24 }: { title: string; values: [string, number][]; selected: string[]; onToggle: (v: string) => void; max?: number }) {
  const [all, setAll] = useState(false);
  if (!values.length) return null;
  const shown = all ? values : values.slice(0, max);
  return (
    <FilterGroup title={title}>
      <div className="chip-wrap">
        {shown.map(([v, n]) => (
          <button key={v} className={`chip ${selected.includes(v) ? "on" : ""}`} onClick={() => onToggle(v)} aria-pressed={selected.includes(v)}>
            {v} <span className="sub">{n}</span>
          </button>
        ))}
        {values.length > max && (
          <button className="chip" onClick={() => setAll(!all)}>
            {all ? "Weniger" : `+${values.length - max} mehr`}
          </button>
        )}
      </div>
    </FilterGroup>
  );
}

