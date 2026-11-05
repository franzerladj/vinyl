// Gig als Kalender-Eintrag: .ics für Apple, Samsung, Outlook und Co., Links für Google und Outlook im Web.

export interface GigEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, ohne Uhrzeit ganztägig */
  start?: string;
  end?: string;
  location?: string;
  description?: string;
  url?: string;
  /** Erinnerung so viele Minuten vorher */
  alarmMinutes?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const stamp = (d: Date) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Beginn und Ende als lokale Zeit; Ende vor Beginn heißt: nach Mitternacht. Ohne Ende vier Stunden. */
export function gigTimes(e: Pick<GigEvent, "date" | "start" | "end">): { start: Date; end: Date; allDay: boolean } {
  const [y, m, d] = e.date.split("-").map(Number);
  if (!e.start || !/^\d{1,2}:\d{2}$/.test(e.start)) {
    return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1), allDay: true };
  }
  const [sh, sm] = e.start.split(":").map(Number);
  const start = new Date(y, m - 1, d, sh, sm);
  let end: Date;
  if (e.end && /^\d{1,2}:\d{2}$/.test(e.end)) {
    const [eh, em] = e.end.split(":").map(Number);
    end = new Date(y, m - 1, d, eh, em);
    if (end <= start) end = new Date(y, m - 1, d + 1, eh, em);
  } else end = new Date(start.getTime() + 4 * 3600_000);
  return { start, end, allDay: false };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Zeilen nach RFC 5545 auf 75 Bytes falten (UTF-8 nicht mitten im Zeichen trennen) */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(e: GigEvent, now = new Date()): string {
  const t = gigTimes(e);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Crate//Gig//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    t.allDay ? `DTSTART;VALUE=DATE:${ymd(t.start)}` : `DTSTART:${stamp(t.start)}`,
    t.allDay ? `DTEND;VALUE=DATE:${ymd(t.end)}` : `DTEND:${stamp(t.end)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    ...(e.alarmMinutes ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(`Platten packen: ${e.title}`)}`, `TRIGGER:-PT${Math.round(e.alarmMinutes)}M`, "END:VALARM"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Google Kalender: Termin-Vorlage zum Bestätigen */
export function googleCalendarUrl(e: GigEvent): string {
  const t = gigTimes(e);
  const dates = t.allDay ? `${ymd(t.start)}/${ymd(t.end)}` : `${stamp(t.start)}/${stamp(t.end)}`;
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates, ...(e.location ? { location: e.location } : {}), ...(e.description ? { details: e.description } : {}) });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** Outlook im Web (outlook.com und Microsoft 365) */
export function outlookCalendarUrl(e: GigEvent): string {
  const t = gigTimes(e);
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const p = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: e.title, startdt: iso(t.start), enddt: iso(t.end), ...(t.allDay ? { allday: "true" } : {}), ...(e.location ? { location: e.location } : {}), ...(e.description ? { body: e.description } : {}) });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}
