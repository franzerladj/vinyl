// Deezer meldet „zu viele Anfragen“ mit Status 200 und einem error-Objekt. Das darf nie als „keine Hörprobe“
// oder „kein Tempo“ gelten und nicht gemerkt werden (sonst laden beim Diggen eine Stunde lang keine Songs).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeezerBusy, fetchPreview, fetchPreviewById, lookupAudio, matchRelease } from "../server/audio";
import type { Config } from "../server/env";

const QUOTA = { error: { type: "Exception", message: "Quota limit exceeded", code: 4 } };
const HIT = (title: string, artist: string) => ({ data: [{ id: 4711, title, duration: 300, preview: "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3?hdnea=exp", artist: { name: artist } }] });
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

/** fetch nachstellen: api = Antwort je Deezer-Anfrage (Funktion bekommt die Nummer des Aufrufs) */
function stub(api: (n: number, url: string) => unknown) {
  const calls = { api: 0, cdn: 0 };
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.includes("dzcdn.net")) {
      calls.cdn++;
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    }
    return json(api(++calls.api, url));
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("Deezer ausgelastet", () => {
  it("Hörprobe: 503 statt „keine Hörprobe“, und nichts wird gemerkt", async () => {
    const down = stub(() => QUOTA);
    const r = await fetchPreview("Busy Artist", "Busy Track", 300);
    expect(r.status).toBe(503);
    expect(down.cdn).toBe(0);
    // Deezer wieder da: dieselbe Anfrage klappt sofort (keine gemerkte Fehlanzeige)
    const up = stub(() => HIT("Busy Track", "Busy Artist"));
    const ok = await fetchPreview("Busy Artist", "Busy Track", 300);
    expect(ok.status).toBe(200);
    expect(up.cdn).toBe(1);
  });

  it("kurzer Aussetzer: nach einem Augenblick nochmal, dann klappt es ohne Fehler nach außen", async () => {
    const calls = stub((n) => (n <= 2 ? QUOTA : HIT("Blip Track", "Blip Artist")));
    const r = await fetchPreview("Blip Artist", "Blip Track", 300);
    expect(r.status).toBe(200);
    expect(calls.api).toBeGreaterThan(2);
  });

  it("wirklich nichts gefunden: 404, und das wird gemerkt (keine zweite Suche)", async () => {
    const calls = stub(() => ({ data: [] }));
    expect((await fetchPreview("Nobody", "Nothing Here", 200)).status).toBe(404);
    const before = calls.api;
    expect((await fetchPreview("Nobody", "Nothing Here", 200)).status).toBe(404);
    expect(calls.api).toBe(before);
  });

  it("vorbereiten (warm): 204 wenn da, 404 wenn es keine gibt, 503 wenn Deezer bremst", async () => {
    stub(() => HIT("Warm Track", "Warm Artist"));
    expect((await fetchPreview("Warm Artist", "Warm Track", 300, true)).status).toBe(204);
    stub(() => ({ data: [] }));
    expect((await fetchPreview("Warm Nobody", "Warm Nothing", 300, true)).status).toBe(404);
    stub(() => QUOTA);
    expect((await fetchPreview("Warm Busy", "Warm Busy Track", 300, true)).status).toBe(503);
  });

  it("Hörprobe über die Nummer: ausgelastet = 503, gibt es nicht (Code 800) = 404", async () => {
    stub(() => QUOTA);
    expect((await fetchPreviewById(99)).status).toBe(503);
    stub(() => ({ error: { type: "DataException", message: "no data", code: 800 } }));
    expect((await fetchPreviewById(98)).status).toBe(404);
    stub(() => ({ id: 97, preview: "https://cdnt-preview.dzcdn.net/y.mp3" }));
    expect((await fetchPreviewById(97)).status).toBe(200);
    expect((await fetchPreviewById(0)).status).toBe(404);
  });

  it("Tempo-Suche und Album-Zuordnung melden „ausgelastet“ weiter, statt „nichts gefunden“ zu liefern", async () => {
    stub(() => QUOTA);
    await expect(lookupAudio({} as Config, "Busy Artist", "Tempo Track", 300)).rejects.toBeInstanceOf(DeezerBusy);
    await expect(matchRelease("Busy Artist", "Busy Album", [{ key: "1:A", title: "Tempo Track" }])).rejects.toBeInstanceOf(DeezerBusy);
    // Wirklich nichts da: leeres Ergebnis ohne Fehler
    stub(() => ({ data: [] }));
    expect((await lookupAudio({} as Config, "Nobody", "No Tempo", 300)).bpm).toBeNull();
    expect((await matchRelease("Nobody", "No Album", [{ key: "1:A", title: "x" }])).matches).toEqual({});
  });
});
