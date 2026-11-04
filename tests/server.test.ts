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
