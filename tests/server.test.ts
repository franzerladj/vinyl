import { describe, expect, it } from "vitest";
import { seal, unseal } from "../server/session";
import { extractJson } from "../server/ai";
import { parseOcrText } from "../web/src/lib/free";

describe("session", () => {
  it("ver- und entschlüsselt, lehnt fremde Schlüssel ab", async () => {
    const s = await seal("a".repeat(32), { token: "t", secret: "s", username: "franz" });
    expect(await unseal("a".repeat(32), s)).toEqual({ token: "t", secret: "s", username: "franz" });
    expect(await unseal("b".repeat(32), s)).toBeNull();
    expect(await unseal("a".repeat(32), s.slice(0, -2) + "xx")).toBeNull();
  });
});

describe("parsing", () => {
  it("liest JSON aus Modellantworten mit Text drumherum", () => {
    expect(extractJson<{ a: number }>('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
    expect(extractJson("kein json")).toBeNull();
  });
  it("findet Katalognummer und Barcode im OCR-Text", () => {
    const g = parseOcrText("PEACEFROG RECORDS\nMOODYMANN\nBLACK MAHOGANI\nPF117\n33 RPM\n5 024545 123456\nSIDE A");
    expect(g.catno).toBe("PF117");
    expect(g.query).toContain("MAHOGANI");
    expect(g.barcode).toBe("5024545123456");
  });
});

import { modelJson } from "../server/ai";
describe("workers ai antworten", () => {
  it("versteht beide Antwortformate", () => {
    expect(modelJson<{ a: number }>({ response: { a: 1 } })).toEqual({ a: 1 });
    expect(modelJson<{ a: number }>({ response: '```json\n{"a":2}\n```' })).toEqual({ a: 2 });
    expect(modelJson<{ a: number }>({ choices: [{ message: { content: 'x {"a":3} y' } }] })).toEqual({ a: 3 });
  });
});

import { validBarcode } from "../shared/barcode";
describe("barcode", () => {
  it("prüft die Prüfziffer", () => {
    expect(validBarcode("4006381333931")).toBe(true);
    expect(validBarcode("036000291452")).toBe(true);
    expect(validBarcode("07660117019")).toBe(false);
    expect(validBarcode("4006381333932")).toBe(false);
  });
});

describe("Anmeldung vom Gerät", () => {
  it("signiert Parameter für Formular/Query genauso wie den Header", async () => {
    const { oauthHmacHeader, oauthHmacParams } = await import("../server/oauthSign");
    const input = { method: "POST", url: "https://api.discogs.com/oauth/access_token", consumerKey: "ck", consumerSecret: "cs", token: "rt", tokenSecret: "rs", extra: { oauth_verifier: "v" }, fixed: { nonce: "n", timestamp: "1" } };
    const header = await oauthHmacHeader(input);
    const params = await oauthHmacParams(input);
    expect(header).toContain(`oauth_signature="${encodeURIComponent(params.oauth_signature)}"`);
    expect(params.oauth_verifier).toBe("v");
    expect(params.oauth_token).toBe("rt");
  });
});
