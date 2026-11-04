import { describe, expect, it } from "vitest";
import { bundle, dueReminders, encryptPayload, wantChange, type UserRec } from "../server/push";

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const hmac = async (key: Uint8Array, data: Uint8Array) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data));
const cat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));

describe("Web Push", () => {
  it("verschlüsselt so, dass das Gerät es entschlüsseln kann (RFC 8291)", async () => {
    // Gerät: Schlüsselpaar und Auth-Geheimnis
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload({ endpoint: "https://push.example/x", keys: { p256dh: b64u(uaPub), auth: b64u(auth) } }, new TextEncoder().encode('{"title":"Hallo"}'));
    // Gerät entschlüsselt
    const salt = body.slice(0, 16);
    const idlen = body[20];
    const asPub = body.slice(21, 21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
    const enc = new TextEncoder();
    const ikm = await hmac(await hmac(auth, ecdh), cat(enc.encode("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])));
    const prk = await hmac(salt, ikm);
    const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
    const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), body.slice(21 + idlen)));
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Hallo"}');
    expect(plain.at(-1)).toBe(2);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
  });

  it("meldet Verfügbarkeit, Wunschpreis und Preissturz", () => {
    const w = { id: 1, t: "Altered States", a: "Ron Trent" };
    expect(wantChange({ ...w, n: 0, low: null }, { num_for_sale: 2, lowest_price: { value: 30, currency: "EUR" } })?.title).toBe("Wieder verfügbar");
    expect(wantChange({ ...w, n: 3, low: 40, target: 30 }, { num_for_sale: 3, lowest_price: { value: 28, currency: "EUR" } })?.title).toBe("Unter deinem Wunschpreis");
    expect(wantChange({ ...w, n: 3, low: 40 }, { num_for_sale: 3, lowest_price: { value: 30, currency: "EUR" } })?.title).toBe("Preis gefallen");
    expect(wantChange({ ...w, n: 3, low: 40 }, { num_for_sale: 3, lowest_price: { value: 39, currency: "EUR" } })).toBeNull();
    // Erster Blick (noch kein Stand): nichts melden
    expect(wantChange(w, { num_for_sale: 3, lowest_price: { value: 39, currency: "EUR" } })).toBeNull();
  });

  it("erinnert an verliehene Platten und Sets genau einmal", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const rec = { lent: [{ id: 7, t: "Pieces", to: "kumpel", at: now - 22 * 86_400_000 }], sets: [{ id: 3, name: "Freitag", date: "2026-11-20" }], sent: {} } as unknown as UserRec;
    const due = dueReminders(rec, now);
    expect(due.map((d) => d.key)).toEqual(["lent-7-3", "set-3-2026-11-20"]);
    expect(dueReminders({ ...rec, sent: { "lent-7-3": 1, "set-3-2026-11-20": 1 } }, now)).toEqual([]);
  });

  it("bündelt mehrere Meldungen", () => {
    expect(bundle([{ title: "A", body: "1" }, { title: "B", body: "2" }])?.title).toBe("2 Neuigkeiten auf deiner Wantlist");
  });
});

describe("Auswahl der Wants pro Runde", () => {
  it("prüft wichtige Wants öfter und kommt reihum bei allen vorbei", async () => {
    const { pickWants } = await import("../server/push");
    const wants = Array.from({ length: 60 }, (_, i) => ({ id: i, t: "", a: "", n: i < 10 ? 0 : 5, low: 10, target: i === 59 ? 8 : null }));
    const seen = new Map<number, number>();
    for (let slot = 0; slot < 10; slot++) for (const i of pickWants(wants, slot, 20, 10)) seen.set(i, (seen.get(i) ?? 0) + 1);
    // 11 wichtige (10 ohne Angebot + 1 mit Wunschpreis) in jeder Runde
    expect(seen.get(0)).toBe(10);
    expect(seen.get(59)).toBe(10);
    // Alle anderen kommen in 10 Runden mindestens einmal dran
    for (let i = 10; i < 59; i++) expect(seen.get(i) ?? 0).toBeGreaterThanOrEqual(1);
  });
});
