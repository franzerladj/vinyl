// Erinnerungen des Zeitplans: wann kommt welche Mitteilung, und kommt jede nur einmal?
import { describe, expect, it } from "vitest";
import { dueReminders, KIND_DEFAULT, kindOn, type UserRec } from "../server/push";

const base = (over: Partial<UserRec> = {}): UserRec => ({ subs: [], prefs: { ...KIND_DEFAULT }, sess: "", wants: [], lent: [], sets: [], cursor: 0, sent: {}, updatedAt: 0, tz: -60, ...over });
const at = (iso: string) => Date.parse(iso);
const keys = (rec: UserRec, iso: string) => dueReminders(rec, at(iso)).map((d) => d.key);

describe("Gig: Vorabend, Tag selbst, Tag danach", () => {
  const rec = base({ sets: [{ id: 3, name: "Freitag Klubraum", date: "2026-11-27", start: "22:00", n: 32 }] });
  it("am Vorabend ab 18 Uhr Ortszeit, mit Beginn und Kiste", () => {
    expect(keys(rec, "2026-11-26T16:30:00Z")).toEqual([]); // 17:30 in Berlin
    const due = dueReminders(rec, at("2026-11-26T17:05:00Z")); // 18:05
    expect(due.map((d) => d.key)).toEqual(["setpre-3-2026-11-27"]);
    expect(due[0].msg.title).toBe("Morgen um 22:00: Freitag Klubraum");
    expect(due[0].msg.body).toBe("32 Platten in der Kiste. Nadeln und Kopfhörer nicht vergessen.");
    expect(due[0].msg.url).toBe("/sets/3");
  });
  it("am Vorabend zählt die Nadel, wenn sie fast durch ist", () => {
    const worn = dueReminders({ ...rec, stylus: { pct: 0.94, name: "Concorde Club" } }, at("2026-11-26T18:00:00Z"));
    expect(worn[0].msg.body).toBe("32 Platten in der Kiste. Deine Nadel (Concorde Club) hat schon 94 % ihrer Stunden.");
    const fresh = dueReminders({ ...rec, stylus: { pct: 0.4 } }, at("2026-11-26T18:00:00Z"));
    expect(fresh[0].msg.body).not.toMatch(/Nadel hat/);
  });
  it("am Tag selbst ab 10 Uhr", () => {
    expect(keys(rec, "2026-11-27T08:30:00Z")).toEqual([]); // 9:30
    const due = dueReminders(rec, at("2026-11-27T09:10:00Z"));
    expect(due.map((d) => d.key)).toEqual(["set-3-2026-11-27"]);
    expect(due[0].msg.title).toBe("Heute um 22:00: Freitag Klubraum");
  });
  it("am Tag danach ab 11 Uhr: was lief?", () => {
    const due = dueReminders(rec, at("2026-11-28T10:30:00Z"));
    expect(due.map((d) => d.key)).toEqual(["setpost-3-2026-11-27"]);
    expect(due[0].msg.title).toBe("Wie lief Freitag Klubraum?");
    // Zwei Tage später nicht mehr (wer Mitteilungen erst dann einschaltet, bekommt keine alten Fragen)
    expect(keys(rec, "2026-11-29T12:00:00Z")).toEqual([]);
  });
  it("jede nur einmal, und gar nicht, wenn „Deine Gigs“ aus ist", () => {
    expect(keys({ ...rec, sent: { "setpre-3-2026-11-27": 1 } }, "2026-11-26T19:00:00Z")).toEqual([]);
    expect(keys({ ...rec, prefs: { ...KIND_DEFAULT, sets: false } }, "2026-11-26T19:00:00Z")).toEqual([]);
  });
  it("ohne Beginn und Kiste bleibt der alte Wortlaut", () => {
    const plain = base({ sets: [{ id: 3, name: "Freitag", date: "2026-11-20" }] });
    const due = dueReminders(plain, at("2026-11-20T12:00:00Z"));
    expect(due[0].msg).toMatchObject({ title: "Heute ist dein Set", body: "Freitag: Platten einpacken nicht vergessen." });
  });
});

describe("Ortszeit des Geräts", () => {
  it("New York (UTC−5): „Heute“ kommt nicht mitten in der Nacht", () => {
    const rec = base({ tz: 300, sets: [{ id: 1, name: "Loft", date: "2026-11-27" }] });
    expect(keys(rec, "2026-11-27T09:10:00Z")).toEqual([]); // 4:10 in New York
    expect(keys(rec, "2026-11-27T15:10:00Z")).toEqual(["set-1-2026-11-27"]); // 10:10
    // Der Vorabend beginnt nach dortiger Uhr: 26.11. 18 Uhr = 23 Uhr UTC
    expect(keys(rec, "2026-11-26T23:05:00Z")).toEqual(["setpre-1-2026-11-27"]);
  });
  it("ohne Angabe gilt Mitteleuropa", () => {
    const rec = base({ sets: [{ id: 1, name: "X", date: "2026-11-27" }] });
    delete rec.tz;
    expect(keys(rec, "2026-11-27T09:10:00Z")).toEqual(["set-1-2026-11-27"]);
  });
});

describe("Rückblick und Platte des Tages", () => {
  it("Jahresrückblick im Dezember, einmal", () => {
    const rec = base();
    expect(keys(rec, "2026-11-30T12:00:00Z")).toEqual([]);
    const due = dueReminders(rec, at("2026-12-01T09:30:00Z"));
    expect(due.map((d) => [d.key, d.kind, d.msg.url])).toEqual([["year-2026", "tips", "/year"]]);
    expect(keys({ ...rec, sent: { "year-2026": 1 } }, "2026-12-05T12:00:00Z")).toEqual([]);
    // Im nächsten Jahr wieder
    expect(keys({ ...rec, sent: { "year-2026": 1 } }, "2027-12-02T12:00:00Z")).toEqual(["year-2027"]);
  });
  it("Platte des Tages nur für den, der sie eingeschaltet hat, am Vormittag", () => {
    const daily = [{ d: "2026-11-21", id: 5, t: "Sound Sculptures", a: "Theo Parrish", why: "Heute vor 3 Jahren gekauft" }];
    expect(keys(base({ daily }), "2026-11-21T10:00:00Z")).toEqual([]); // Vorgabe: aus
    const on = base({ daily, prefs: { ...KIND_DEFAULT, daily: true } });
    expect(keys(on, "2026-11-21T07:30:00Z")).toEqual([]); // 8:30
    const due = dueReminders(on, at("2026-11-21T08:10:00Z"));
    expect(due[0]).toMatchObject({ key: "daily-2026-11-21", kind: "daily", msg: { title: "Platte des Tages", body: "Theo Parrish – Sound Sculptures. Heute vor 3 Jahren gekauft", url: "/release/5" } });
    expect(keys(on, "2026-11-22T10:00:00Z")).toEqual([]); // für diesen Tag liegt nichts vor
  });
});

describe("Einstellungen älterer Einträge", () => {
  it("neue Arten gelten mit ihrer Vorgabe, wenn sie noch nie eingestellt wurden", () => {
    const old = { prefs: { friends: true, wants: false, lent: true, sets: true, sellers: true } } as unknown as UserRec;
    expect(kindOn(old, "tips")).toBe(true);
    expect(kindOn(old, "daily")).toBe(false);
    expect(kindOn(old, "wants")).toBe(false);
  });
});
