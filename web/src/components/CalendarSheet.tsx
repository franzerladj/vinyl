// Gig in den Kalender: eine Datei für Apple, Samsung, Outlook und Co., Links für Google und Outlook im Web
import { haptic, Sheet } from "./bits";
import { googleCalendarUrl, outlookCalendarUrl, type GigEvent } from "../../../shared/ics";

export function icsUrl(e: GigEvent) {
  const p = new URLSearchParams({ u: e.uid, t: e.title, d: e.date, ...(e.start ? { s: e.start } : {}), ...(e.end ? { e: e.end } : {}), ...(e.location ? { l: e.location } : {}), ...(e.description ? { n: e.description } : {}), ...(e.alarmMinutes ? { a: String(e.alarmMinutes) } : {}) });
  return `/api/ics?${p}`;
}

export function CalendarSheet({ open, onClose, event, onDone }: { open: boolean; onClose: () => void; event: GigEvent | null; onDone: () => void }) {
  if (!event) return null;
  const when = new Date(event.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const go = (url: string, newTab = false) => {
    haptic(10);
    onDone();
    if (newTab) window.open(url, "_blank", "noopener");
    else location.href = url;
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack cal-sheet">
        <div>
          <span className="eyebrow">In den Kalender</span>
          <b style={{ fontSize: 20, display: "block", marginTop: 4 }}>{event.title}</b>
          <span className="sub">
            {when}
            {event.start ? `, ${event.start}${event.end ? ` bis ${event.end}` : ""} Uhr` : ", ganztägig"}
            {event.location ? ` · ${event.location}` : ""}
          </span>
        </div>
        <button className="btn primary block lg" onClick={() => go(icsUrl(event))}>
          Kalender auf diesem Handy
        </button>
        <span className="tiny" style={{ marginTop: -4 }}>iPhone, Samsung, Outlook und die meisten Kalender-Apps. Mit Erinnerung drei Stunden vorher zum Platten packen.</span>
        <div className="grid2">
          <button className="btn block" onClick={() => go(googleCalendarUrl(event), true)}>
            Google Kalender
          </button>
          <button className="btn block" onClick={() => go(outlookCalendarUrl(event), true)}>
            Outlook im Web
          </button>
        </div>
        <button className="btn ghost block" onClick={onClose}>
          Später
        </button>
      </div>
    </Sheet>
  );
}
