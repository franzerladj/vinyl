// Claude-gestützte Funktionen: Plattencover/Etikett erkennen und Vibe/Energie taggen.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicKey || undefined }));
export const aiEnabled = () => Boolean(config.anthropicKey);

const MODEL = "claude-opus-5-5";

async function jsonCall<T>(content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, system: string): Promise<T> {
  const res = await getClient().beta.messages.create({
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

export async function recognizeRecord(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<Recognition> {
  return jsonCall<Recognition>(
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

export async function tagVibes(items: VibeInput[]): Promise<VibeOutput[]> {
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
    [{ type: "text", text: "Schätze für jeden Track Energie, Vibe-Tags und den passenden Slot im DJ-Set ein. Nutze dein Wissen über die Tracks, sonst Stil, Jahr und BPM.\n\n" + JSON.stringify(items) }],
    schema,
    "Du bist ein erfahrener Vinyl-DJ und kuratierst Sets für Clubs und Bars.",
  );
  return out.items.map((i) => ({ ...i, energy: Math.max(1, Math.min(10, Math.round(i.energy))) }));
}
