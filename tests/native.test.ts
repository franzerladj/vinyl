// Mitteilungen für die Android-App ohne Browser: Speicher (Arbeitsspeicher und D1-SQL gegen echtes SQLite) und Routen
import { describe, expect, it } from "vitest";
import { d1Native, memoryNative, NATIVE_SCHEMA, pick, QUEUE_MAX, QUEUE_MAX_AGE, type NativeStore } from "../server/native";
import type { D1Like } from "../server/devsync";
import { app } from "../server/app";
import { seal } from "../server/session";

async function sqlite(): Promise<D1Like | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const s of NATIVE_SCHEMA) db.exec(s);
    const stmt = (sql: string) => ({
      bind: (...v: unknown[]) => {
        const p = db.prepare(sql);
        const args = v as (string | number | null)[];
        return {
          all: async <T,>() => ({ results: p.all(...args) as T[] }),
          first: async <T,>() => (p.get(...args) as T) ?? null,
          run: async () => p.run(...args),
        };
      },
    });
    return { prepare: stmt, batch: async (stmts: unknown[]) => Promise.all((stmts as { run(): Promise<unknown> }[]).map((s) => s.run())) };
  } catch {
    return null;
  }
}

const A = "a".repeat(64);
const B = "b".repeat(64);

async function exercise(store: NativeStore) {
  await store.link(A, "franz", 1);
  await store.link(B, "franz", 2);
  expect(await store.device(A)).toEqual({ user: "franz", seen: null, ok: false });
  expect(await store.device("c".repeat(64))).toBeNull();
  await store.touch(A, true, 50);
  expect(await store.device(A)).toEqual({ user: "franz", seen: 50, ok: true });
  // Erneutes Verbinden desselben Kennworts ändert nichts (kein Überschreiben des Besitzers)
  await store.link(A, "jemand", 60);
  expect((await store.device(A))?.user).toBe("franz");
  await store.enqueue([A, B], { title: "Neue Angebote", body: "3 Wants", url: "/wants", tag: "wants" });
  await store.enqueue([A], { title: "Anfrage", body: "kumpel", url: "/friends", tag: "friend-kumpel", urgent: true });
  const got = await store.take(A);
  expect(got.map((m) => m.title)).toEqual(["Neue Angebote", "Anfrage"]);
  // „urgent“ ist Sache des Browser-Wegs und wandert nicht mit
  expect(got[1]).toEqual({ title: "Anfrage", body: "kumpel", url: "/friends", tag: "friend-kumpel" });
  // Abgeholt ist abgeholt, das andere Gerät hat seine noch
  expect(await store.take(A)).toEqual([]);
  expect((await store.take(B)).map((m) => m.title)).toEqual(["Neue Angebote"]);
  await store.enqueue([A], { title: "x", body: "y" });
  await store.remove(A);
  expect(await store.device(A)).toBeNull();
  expect(await store.take(A)).toEqual([]);
  await store.enqueue([B], { title: "x", body: "y" });
  await store.clear("franz");
  expect(await store.device(B)).toBeNull();
  expect(await store.take(B)).toEqual([]);
}

describe("Mitteilungen der Android-App: Speicher", () => {
  it("Arbeitsspeicher", async () => exercise(memoryNative()));
  it("D1-SQL gegen SQLite", async () => {
    const db = await sqlite();
    if (!db) return;
    await exercise(d1Native(db));
  });
  it("gleiches Kennzeichen: nur die neueste, Altes verfällt, höchstens ein Dutzend", () => {
    const now = 10 * 86_400_000;
    const rows = [
      { ts: now - QUEUE_MAX_AGE - 1, msg: { title: "zu alt", body: "" } },
      { ts: now - 5000, msg: { title: "3 Angebote", body: "", tag: "wants" } },
      { ts: now - 4000, msg: { title: "Anfrage", body: "", tag: "friend-a" } },
      { ts: now - 3000, msg: { title: "5 Angebote", body: "", tag: "wants" } },
    ];
    expect(pick(rows, now).map((m) => m.title)).toEqual(["Anfrage", "5 Angebote"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ts: now, msg: { title: `m${i}`, body: "" } }));
    const out = pick(many, now);
    expect(out).toHaveLength(QUEUE_MAX);
    expect(out[out.length - 1].title).toBe("m29");
  });
});

describe("Mitteilungen der Android-App: Routen", () => {
  const SECRET = "testtesttesttesttesttesttesttest";
  const ORIGIN = "https://crate.test";
  const env = { SESSION_SECRET: SECRET, APP_URL: ORIGIN };
  const cookie = async (u: string) => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username: u, verified: true, iat: Date.now() })}`;
  const post = async (u: string | null, path: string, body: unknown) =>
    app.request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", ...(u ? { Cookie: await cookie(u) } : {}) }, body: JSON.stringify(body) }, env);
  const get = async (u: string | null, path: string) => app.request(`${ORIGIN}${path}`, { headers: u ? { Cookie: await cookie(u) } : {} }, env);
  // Die App: kein Cookie, keine Herkunft, nur das Kennwort
  const poll = async (t: string, ok: boolean) => {
    const r = await app.request(`${ORIGIN}/api/push/native/poll?t=${t}&ok=${ok ? 1 : 0}&v=10`, {}, env);
    return { status: r.status, body: (await r.json()) as { messages?: { title: string; url?: string; tag?: string }[] } };
  };

  it("Einschalten, Abholen, Freund meldet sich, Ausschalten", async () => {
    expect((await post(null, "/api/push/native/start", {})).status).toBe(401);
    const start = (await (await post("NativeAnna", "/api/push/native/start", {})).json()) as { token: string };
    expect(start.token).toMatch(/^[a-f0-9]{64}$/);
    // Noch hat die App nicht abgeholt
    expect(await (await get("NativeAnna", `/api/push/native/status?t=${start.token}`)).json()).toEqual({ known: true, linked: false, ok: false });
    // Fremde sehen den Stand nicht
    expect(await (await get("NativeBob", `/api/push/native/status?t=${start.token}`)).json()).toEqual({ known: false, linked: false, ok: false });
    // Android erlaubt (noch) nichts: verbunden, aber nichts wird ausgeliefert und nichts geht verloren
    expect((await poll(start.token, false)).body.messages).toEqual([]);
    expect(await (await get("NativeAnna", `/api/push/native/status?t=${start.token}`)).json()).toEqual({ known: true, linked: true, ok: false });
    // Erlaubt: die Begrüßung kommt
    const first = await poll(start.token, true);
    expect(first.body.messages?.map((m) => m.tag)).toEqual(["welcome"]);
    expect(await (await get("NativeAnna", `/api/push/native/status?t=${start.token}`)).json()).toEqual({ known: true, linked: true, ok: true });
    expect(((await (await get("NativeAnna", "/api/push/status")).json()) as { devices: number }).devices).toBe(1);
    // Test-Mitteilung und Mitteilung vom eigenen Gerät
    expect(((await (await post("NativeAnna", "/api/push/test", {})).json()) as { sent: number }).sent).toBe(1);
    expect(((await (await post("NativeAnna", "/api/push/native/self", { token: start.token, title: "Neue Pressung", body: "Theo Parrish", url: "/wants", tag: "wants" })).json()) as { ok: boolean }).ok).toBe(true);
    // Fremde können nichts in die Schlange legen
    expect(((await (await post("NativeBob", "/api/push/native/self", { token: start.token, title: "Spam", body: "" })).json()) as { ok: boolean }).ok).toBe(false);
    // Freundschaftsanfrage von Bob
    expect((await post("NativeBob", "/api/friends/request", { to: "NativeAnna" })).status).toBe(200);
    const next = await poll(start.token, true);
    expect(next.body.messages?.map((m) => m.title)).toEqual(["Crate", "Neue Pressung", "Freundschaftsanfrage"]);
    expect(next.body.messages?.[2].url).toBe("/friends");
    expect((await poll(start.token, true)).body.messages).toEqual([]);
    // Schalter erneut angetippt: neues Kennwort, das alte gilt nicht mehr
    const again = (await (await post("NativeAnna", "/api/push/native/start", { replace: start.token })).json()) as { token: string };
    expect(again.token).not.toBe(start.token);
    expect((await poll(start.token, true)).status).toBe(410);
    expect(((await (await get("NativeAnna", "/api/push/status")).json()) as { devices: number }).devices).toBe(1);
    // Ausschalten: die App bekommt 410 und hört auf, auf dem Server bleibt nichts
    await post("NativeAnna", "/api/push/native/stop", { token: again.token });
    expect((await poll(again.token, true)).status).toBe(410);
    expect(((await (await get("NativeAnna", "/api/push/status")).json()) as { devices: number }).devices).toBe(0);
  });

  it("Unbekanntes oder kaputtes Kennwort: 410", async () => {
    expect((await poll("f".repeat(64), true)).status).toBe(410);
    expect((await poll("../x", true)).status).toBe(410);
  });
});
