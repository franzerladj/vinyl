// Platte auf Fotos erkennen und Vibe/Energie schätzen, über Cloudflare Workers AI (kostenloses Tageskontingent).
import type { AiBinding } from "./env";
import { validBarcode } from "../shared/barcode";

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

// Modelle mit Ersatz, falls Cloudflare eins abkündigt (Stand November 2026 getestet)
const VISION_MODELS = ["@cf/meta/llama-3.2-11b-vision-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/google/gemma-4-26b-a4b-it"];
const TEXT_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"];

/** Bei Abkündigung das nächste Modell nehmen */
async function runModels(ai: AiBinding, models: string[], input: Record<string, unknown>) {
  let last: unknown;
  for (const model of models) {
    try {
      return await ai.run(model, input);
    } catch (e) {
      last = e;
      const msg = String((e as Error).message);
      if (/agree|licen[sc]e/i.test(msg)) {
        try {
          await ai.run(model, { prompt: "agree" });
        } catch {
          /* Cloudflare meldet die Zustimmung selbst als Fehler 5016 */
        }
        try {
          return await ai.run(model, input);
        } catch (e2) {
          last = e2;
        }
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
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

/** Antworten kommen je nach Modell als {response: string|object} oder im OpenAI-Format */
export function modelJson<T>(r: unknown): T | null {
  if (!r || typeof r !== "object") return typeof r === "string" ? extractJson<T>(r) : null;
  const o = r as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const v = o.response ?? o.choices?.[0]?.message?.content;
  if (v && typeof v === "object") return v as T;
  return typeof v === "string" ? extractJson<T>(v) : null;
}

export async function recognizeRecordFree(ai: AiBinding, imageBase64: string, mediaType: string): Promise<Recognition> {
  const r = await runModels(ai, VISION_MODELS, {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: 'This photo shows a vinyl record (cover, back, center label or runout). Read all visible text. Answer only with one JSON object with the keys "artist", "title", "label", "catno" (catalog number), "barcode" (digits only), "year", "matrix". Use an empty string for anything you cannot read. Do not guess.',
          },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
        ],
      },
    ],
    max_tokens: 400,
    temperature: 0.1,
  });
  const j = modelJson<Partial<Recognition>>(r) ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
  return {
    artist: str(j.artist),
    title: str(j.title),
    label: str(j.label),
    catno: str(j.catno),
    // Kleine Modelle erfinden gern Barcodes: nur mit gültiger Prüfziffer übernehmen
    barcode: validBarcode(str(j.barcode)) ? str(j.barcode).replace(/\D/g, "") : "",
    year: /^(19|20)\d\d$/.test(str(j.year)) ? str(j.year) : "",
    matrix: str(j.matrix),
    confidence: "mittel",
    notes: "Erkannt mit dem kostenlosen Bildmodell (Workers AI).",
  };
}

export async function tagVibesFree(ai: AiBinding, items: VibeInput[]): Promise<VibeOutput[]> {
  const r = await runModels(ai, TEXT_MODELS, {
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
  const j = modelJson<{ items?: VibeOutput[] }>(r);
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
