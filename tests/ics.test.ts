import { describe, expect, it } from "vitest";
import { buildIcs, gigTimes, googleCalendarUrl } from "../shared/ics";

const gig = { uid: "set-7@crate", title: "Freitag Klubraum", date: "2026-11-13", start: "22:00", end: "04:00", location: "Glashaus, Bayreuth", description: "12 Platten, 24 Tracks\nAm Ende: Can You Feel It", alarmMinutes: 180 };

describe("Gig in den Kalender", () => {
  it("Ende nach Mitternacht landet am nächsten Tag", () => {
    const t = gigTimes(gig);
    expect(t.end.getDate()).toBe(14);
    expect(t.end.getHours()).toBe(4);
  });
  it("erzeugt gültiges iCalendar mit CRLF, Escapes und Erinnerung", () => {
    const ics = buildIcs(gig, new Date(Date.UTC(2026, 10, 5, 12)));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261113T220000\r\n");
    expect(ics).toContain("DTEND:20261114T040000\r\n");
    expect(ics).toContain("LOCATION:Glashaus\\, Bayreuth");
    expect(ics).toContain("DESCRIPTION:12 Platten\\, 24 Tracks\\nAm Ende: Can You Feel It");
    expect(ics).toContain("TRIGGER:-PT180M");
    expect(ics).toContain("DTSTAMP:20261105T120000Z");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("ohne Uhrzeit ganztägig", () => {
    const ics = buildIcs({ uid: "x", title: "Gig", date: "2026-12-31" });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
  });
  it("faltet lange Zeilen", () => {
    const ics = buildIcs({ uid: "x", title: "Ä".repeat(60), date: "2026-12-31" });
    expect(ics).toMatch(/SUMMARY:Ä+\r\n Ä+/);
  });
  it("Google-Link mit Zeitraum", () => {
    expect(googleCalendarUrl(gig)).toContain("dates=20261113T220000%2F20261114T040000");
  });
});

describe("/api/ics", () => {
  it("liefert eine Kalender-Datei nur angemeldet", async () => {
    const { app } = await import("../server/app");
    const { seal } = await import("../server/session");
    const env = { SESSION_SECRET: "x".repeat(40), APP_URL: "https://crate.test" };
    const q = "?t=Freitag%20Klubraum&d=2026-11-13&s=22:00&e=04:00&l=Glashaus&a=180&u=set-1@crate";
    expect((await app.request(`https://crate.test/api/ics${q}`, {}, env)).status).toBe(401);
    const cookie = `crate_session=${await seal(env.SESSION_SECRET, { token: "t", secret: "s", username: "franz", verified: true, iat: Date.now() })}`;
    const r = await app.request(`https://crate.test/api/ics${q}`, { headers: { Cookie: cookie } }, env);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/calendar");
    const body = await r.text();
    expect(body).toContain("SUMMARY:Freitag Klubraum");
    expect(body).toContain("DTEND:20261114T040000");
    expect(r.headers.get("Content-Disposition")).toContain('filename="Freitag-Klubraum.ics"');
  });
});
