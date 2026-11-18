// Update-Mitteilung: jeder mit eingeschalteten Mitteilungen bekommt sie genau einmal
import { describe, expect, it } from "vitest";
import { app } from "../server/app";
import { ANNOUNCE } from "../shared/announce";

describe("Update-Mitteilung", () => {
  it("wird beim Zeitplan-Lauf einmal vermerkt und danach nicht wiederholt", async () => {
    const kv = new Map<string, string>();
    let writes = 0;
    const env = {
      SESSION_SECRET: "x".repeat(32),
      CRON_SECRET: "geheim",
      PUSH: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => (writes++, void kv.set(k, v)), delete: async (k: string) => void kv.delete(k), list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })), list_complete: true }) },
    };
    kv.set("u:franz", JSON.stringify({ subs: [{ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" }, addedAt: 1 }], prefs: { friends: true, wants: false, lent: false, sets: false, sellers: false }, sess: "", wants: [], lent: [], sets: [], cursor: 0, sent: {}, updatedAt: 1 }));
    const run = () => app.request("https://crate.example/api/push/run?u=franz", { method: "POST", headers: { "X-Cron-Secret": "geheim", Origin: "https://crate.example", "Sec-Fetch-Site": "same-origin" } }, env);
    expect((await run()).status).toBe(200);
    expect(JSON.parse(kv.get("u:franz")!).announce).toBe(ANNOUNCE?.id);
    const before = writes;
    await run();
    expect(writes).toBe(before); // nichts Neues: kein weiterer Schreibvorgang, keine zweite Mitteilung
  });
});
