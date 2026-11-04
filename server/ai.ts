// KI-Funktionen: Platte auf Fotos erkennen und Vibe/Energie schätzen.
// Zwei Wege: Claude (beste Qualität, kostet pro Aufruf) und Cloudflare Workers AI
// (kostenloses Tageskontingent, etwas schwächer).
import Anthropic from "@anthropic-ai/sdk";
import type { AiBinding } from "./env";

const MODEL = "claude-opus-5-5";
const clients = new Map<string, Anthropic>();
const getClient = (apiKey: string) => {
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
};

async function jsonCall<T>(apiKey: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, system: string): Promise<T> {
  const res = await getClient(apiKey).beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    // Bei einer Ablehnung durch Sicherheitsfilter springt serverseitig ein Ersatzmodell ein
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("Anfrage wurde abgelehnt");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

export interface Recognition {
  artist: string;
  title: string;
  label: string;
  catno: string;
  barcode: string;
  year: string;
  matrix: string;
  confidence: "hoch" | "mittel" | "niedrig";
  notes: string;
}

const recognitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["artist", "title", "label", "catno", "barcode", "year", "matrix", "confidence", "notes"],
  properties: {
    artist: { type: "string" },
    title: { type: "string", description: "Titel der Platte (Album/EP/Single)" },
    label: { type: "string" },
    catno: { type: "string", description: "Katalognummer, z.B. 'WARP12' oder 'TRESOR 100'" },
    barcode: { type: "string", description: "Nur Ziffern, leer wenn nicht lesbar" },
    year: { type: "string" },
    matrix: { type: "string", description: "Matrix/Runout-Gravur, falls sichtbar" },
    confidence: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
    notes: { type: "string", description: "Kurzer Hinweis auf Deutsch, was erkannt wurde" },
  },
};

export async function recognizeRecord(apiKey: string, imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<Recognition> {
  return jsonCall<Recognition>(
    apiKey,
    [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      {
        type: "text",
        text:
          "Das Foto zeigt eine Schallplatte (Cover, Rückseite, Center-Label oder Runout). " +
          "Lies alle sichtbaren Angaben ab, die helfen, genau diese Pressung auf Discogs zu finden. " +
          "Erfinde nichts: Was du nicht lesen kannst, bleibt ein leerer String.",
      },
    ],
    recognitionSchema,
    "Du bist ein Vinyl-Experte und identifizierst Schallplatten für die Suche in der Discogs-Datenbank.",
  );
}

export interface VibeInput {
  id: string;
  artist: string;
  title: string;
  styles: string[];
  year?: number;
  bpm?: number;
}
export interface VibeOutput {
  id: string;
  energy: number;
  moods: string[];
  slot: "warmup" | "build" | "peak" | "closing";
}

export async function tagVibes(apiKey: string, items: VibeInput[]): Promise<VibeOutput[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "energy", "moods", "slot"],
          properties: {
            id: { type: "string" },
            energy: { type: "integer", description: "1 (sehr ruhig) bis 10 (Peak-Time-Banger)" },
            moods: { type: "array", items: { type: "string" }, description: "2-4 kurze Vibe-Tags auf Deutsch oder Englisch, z.B. 'deep', 'housy', 'dark', 'euphorisch', 'funky'" },
            slot: { type: "string", enum: ["warmup", "build", "peak", "closing"] },
          },
        },
      },
    },
  };
  const out = await jsonCall<{ items: VibeOutput[] }>(
    apiKey,
    [{ type: "text", text: "Schätze für jeden Track Energie, Vibe-Tags und den passenden Slot im DJ-Set ein. Nutze dein Wissen über die Tracks, sonst Stil, Jahr und BPM.\n\n" + JSON.stringify(items) }],
    schema,
    "Du bist ein erfahrener Vinyl-DJ und kuratierst Sets für Clubs und Bars.",
  );
  return out.items.map((i) => ({ ...i, energy: Math.max(1, Math.min(10, Math.round(i.energy))) }));
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI (kostenloses Kontingent)
// ---------------------------------------------------------------------------
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** Llama-Modelle verlangen einmalig die Zustimmung zur Meta-Lizenz */
async function runWithLicense(ai: AiBinding, model: string, input: Record<string, unknown>) {
  try {
    return await ai.run(model, input);
  } catch (e) {
    if (!/agree|licen[sc]e/i.test(String((e as Error).message))) throw e;
    await ai.run(model, { prompt: "agree" });
    return ai.run(model, input);
  }
}

/** Erstes {...}-Objekt aus einer Modellantwort lesen (kleine Modelle schreiben gern Text drumherum) */
export function extractJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const responseText = (r: unknown) => (typeof r === "object" && r && "response" in r ? String((r as { response: unknown }).response ?? "") : String(r ?? ""));

export async function recognizeRecordFree(ai: AiBinding, imageBase64: string, mediaType: string): Promise<Recognition> {
  const r = await runWithLicense(ai, VISION_MODEL, {
    messages: [
      {
        role: "system",
        content: "You identify vinyl records from photos for a search in the Discogs database. Answer only with one JSON object, no other text.",
      },
      {
        role: "user",
        content:
          'Read all visible text on this record cover, back or center label. Return JSON with the keys "artist", "title", "label", "catno" (catalog number), "barcode" (digits only), "year", "matrix". Use an empty string for anything you cannot read. Do not guess.',
      },
    ],
    image: `data:${mediaType};base64,${imageBase64}`,
    max_tokens: 400,
    temperature: 0.1,
  });
  const j = extractJson<Partial<Recognition>>(responseText(r)) ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
  return {
    artist: str(j.artist),
    title: str(j.title),
    label: str(j.label),
    catno: str(j.catno),
    barcode: str(j.barcode).replace(/\D/g, ""),
    year: str(j.year),
    matrix: str(j.matrix),
    confidence: "mittel",
    notes: "Erkannt mit dem kostenlosen Bildmodell (Workers AI).",
  };
}

export async function tagVibesFree(ai: AiBinding, items: VibeInput[]): Promise<VibeOutput[]> {
  const r = await runWithLicense(ai, TEXT_MODEL, {
    messages: [
      { role: "system", content: "You are an experienced vinyl DJ. Answer only with one JSON object, no other text." },
      {
        role: "user",
        content:
          'For each track estimate energy (integer 1-10), 2-4 short vibe tags (e.g. deep, dark, funky, euphoric, jazzy) and the DJ set slot ("warmup", "build", "peak" or "closing"). Return {"items":[{"id":"...","energy":5,"moods":["..."],"slot":"build"}]}.\n\n' +
          JSON.stringify(items),
      },
    ],
    max_tokens: 1800,
    temperature: 0.2,
  });
  const j = extractJson<{ items?: VibeOutput[] }>(responseText(r));
  const ids = new Set(items.map((i) => i.id));
  const slots = new Set(["warmup", "build", "peak", "closing"]);
  return (j?.items ?? [])
    .filter((i) => i && ids.has(String(i.id)))
    .map((i) => ({
      id: String(i.id),
      energy: Math.max(1, Math.min(10, Math.round(Number(i.energy) || 5))),
      moods: (Array.isArray(i.moods) ? i.moods : []).map(String).slice(0, 4),
      slot: (slots.has(i.slot) ? i.slot : "build") as VibeOutput["slot"],
    }));
}
