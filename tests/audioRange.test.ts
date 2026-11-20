// Hörproben mit Abschnitten (Range): Safari fragt zuerst „bytes=0-1“ und erwartet 206 mit Content-Range
import { describe, expect, it } from "vitest";
import { audioRange } from "../server/audio";

const audio = () => new Response(new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256)), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
const bytes = async (r: Response) => [...new Uint8Array(await r.arrayBuffer())];

describe("Hörprobe in Abschnitten", () => {
  it("ohne Range: alles, mit Länge und dem Hinweis, dass Abschnitte gehen", async () => {
    const r = await audioRange(audio(), null);
    expect([r.status, r.headers.get("Content-Length"), r.headers.get("Accept-Ranges"), r.headers.get("Content-Type")]).toEqual([200, "1000", "bytes", "audio/mpeg"]);
    expect((await bytes(r)).length).toBe(1000);
  });
  it("Safaris erste Frage bytes=0-1", async () => {
    const r = await audioRange(audio(), "bytes=0-1");
    expect([r.status, r.headers.get("Content-Range"), r.headers.get("Content-Length")]).toEqual([206, "bytes 0-1/1000", "2"]);
    expect(await bytes(r)).toEqual([0, 1]);
  });
  it("offenes Ende, Ende über die Länge hinaus, die letzten Bytes", async () => {
    const a = await audioRange(audio(), "bytes=990-");
    expect([a.status, a.headers.get("Content-Range")]).toEqual([206, "bytes 990-999/1000"]);
    const b = await audioRange(audio(), "bytes=500-99999");
    expect([b.status, b.headers.get("Content-Range"), b.headers.get("Content-Length")]).toEqual([206, "bytes 500-999/1000", "500"]);
    const c = await audioRange(audio(), "bytes=-10");
    expect([c.status, c.headers.get("Content-Range")]).toEqual([206, "bytes 990-999/1000"]);
    expect((await bytes(c))[0]).toBe(990 % 256);
  });
  it("hinter dem Ende: 416", async () => {
    const r = await audioRange(audio(), "bytes=2000-");
    expect([r.status, r.headers.get("Content-Range")]).toEqual([416, "bytes */1000"]);
  });
  it("Unsinn im Kopf: wie ohne Range. Fehler und leere Antworten bleiben, wie sie sind", async () => {
    expect((await audioRange(audio(), "items=1-2")).status).toBe(200);
    expect((await audioRange(new Response("Keine Hörprobe", { status: 404 }), "bytes=0-1")).status).toBe(404);
    expect((await audioRange(new Response(null, { status: 204 }), "bytes=0-1")).status).toBe(204);
  });
});
