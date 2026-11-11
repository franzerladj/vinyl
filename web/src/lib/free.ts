// Kostenlose Anreicherung ohne Claude: Texterkennung auf dem Gerät, Vibe-Regeln,
// Last.fm-Tags und Analyse der Deezer-Hörprobe im Browser.
import { db, type TrackMeta, autoUpdateTrack } from "./db";
import { api } from "./api";
import { getState, jobUpdate } from "./store";
import { analyzeSamples, type AnalysisHints, type AudioAnalysis } from "../../../shared/audioAnalysis";
import { estimateBpm, estimateVibe } from "../../../shared/vibes";
import { validBarcode } from "../../../shared/barcode";
import { parseDuration } from "../../../shared/match";
import { pool } from "./pool";

// ---------------------------------------------------------------------------
// Texterkennung (Tesseract, läuft im Browser)
// ---------------------------------------------------------------------------
export interface OcrGuess {
  text: string;
  catno: string;
  barcode: string;
  query: string;
}

const NOISE = /^(stereo|mono|side|seite|made in|manufactured|all rights|warning|unauthorized|rpm|33|45|lp|ep|\d+\s?rpm|p\s?\d{4}|c\s?\d{4})$/i;

export function parseOcrText(text: string): OcrGuess {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/[^\p{L}\p{N}\s.&'/+-]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 2 && !NOISE.test(l));
  const barcode = text.split(/\n+/).map((l) => l.replace(/[\s-]/g, "")).map((l) => l.match(/^\d{12,13}$/)?.[0]).find((c) => c && validBarcode(c)) ?? "";
  const catnos = [...text.toUpperCase().matchAll(/\b([A-Z]{1,8}[ .-]?\d{1,5}[A-Z]{0,2}(?:[ .-]?\d{1,3})?)\b/g)]
    .map((m) => m[1])
    .filter((c) => !/^(19|20)\d\d$/.test(c.replace(/\D/g, "")) || /[A-Z]{2}/.test(c))
    .filter((c) => !/^(RPM|SIDE|STEREO|MONO)/.test(c) && /\d/.test(c) && /[A-Z]/.test(c) && c.length <= 14);
  // Die längsten Zeilen mit Buchstaben sind meist Artist und Titel
  const words = lines.filter((l) => /\p{L}{3,}/u.test(l) && !/^\d/.test(l)).sort((a, b) => b.length - a.length);
  return { text, catno: catnos[0] ?? "", barcode, query: words.slice(0, 2).join(" ").slice(0, 80) };
}

export async function ocrImage(dataUrl: string, onProgress?: (p: number) => void): Promise<OcrGuess> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, {
    logger: (m: { status: string; progress: number }) => m.status === "recognizing text" && onProgress?.(m.progress),
  });
  try {
    const r = await worker.recognize(dataUrl);
    return parseOcrText(r.data.text);
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Hörprobe analysieren
// ---------------------------------------------------------------------------
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, (r: AudioAnalysis | null) => void>();

/** Rechnet die Analyse in einem Web Worker; ohne Worker-Unterstützung auf dem Hauptthread */
export function analyzeOffThread(samples: Float32Array, sr: number, hints: AnalysisHints = {}): Promise<AudioAnalysis | null> {
  if (!workerBroken && !worker) {
    try {
      worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<{ id: number; result?: AudioAnalysis; error?: string }>) => {
        pending.get(e.data.id)?.(e.data.result ?? null);
        pending.delete(e.data.id);
      };
      worker.onerror = () => {
        workerBroken = true;
        pending.forEach((res) => res(null));
        pending.clear();
      };
    } catch {
      workerBroken = true;
    }
  }
  if (!worker || workerBroken) return Promise.resolve(analyzeSamples(samples, sr, hints));
  const id = ++seq;
  return new Promise((res) => {
    pending.set(id, res);
    worker!.postMessage({ id, samples, sr, hints }, [samples.buffer]);
  });
}

export const previewUrl = (artist: string, title: string, duration?: number | null) =>
  `/api/audio/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}${duration ? `&duration=${duration}` : ""}`;

export async function analyzePreview(artist: string, title: string, duration?: number | null, deezerId?: number | null, hints: AnalysisHints = {}): Promise<AudioAnalysis | null> {
  const res = await fetch(deezerId ? `/api/audio/preview/${deezerId}` : previewUrl(artist, title, duration), { credentials: "include" });
  // 404 = keine passende Hörprobe (endgültig); andere Fehler = später nochmal versuchen
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Hörprobe ${res.status}`);
  const buf = await res.arrayBuffer();
  const sr = 22050;
  // OfflineAudioContext dekodiert direkt in der gewünschten Abtastrate
  const ctx = new OfflineAudioContext(1, sr * 31, sr);
  const audio = await ctx.decodeAudioData(buf);
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }
  return analyzeOffThread(mono, sr, hints);
}

// ---------------------------------------------------------------------------
// Vibes & Energie gratis ergänzen
// ---------------------------------------------------------------------------
interface TagsResp {
  tags: { name: string; count: number }[];
}

export interface FreeOptions {
  /** Hörprobe laden und analysieren (ca. 0,5 MB je Track) */
  audio: boolean;
  /** Vorhandene, automatisch geschätzte Werte überschreiben */
  refresh?: boolean;
}

export async function enrichFree(trackIds: string[] | undefined, opts: FreeOptions) {
  const all = trackIds ? ((await db.tracks.bulkGet(trackIds)).filter(Boolean) as TrackMeta[]) : await db.tracks.toArray();
  const collIds = new Set((await db.collection.toArray()).map((c) => c.releaseId));
  const todo = all.filter((t) => (trackIds || collIds.has(t.releaseId)) && (opts.refresh || t.energy == null || (opts.audio && !t.analyzedAt && (t.analyzeTries ?? 0) < 3)));
  if (!todo.length) return 0;
  const rels = new Map((await db.releases.bulkGet([...new Set(todo.map((t) => t.releaseId))])).filter(Boolean).map((r) => [r!.id, r!]));
  const lastfm = getState().me?.features.lastfm;
  const durationOf = (t: TrackMeta) => parseDuration(rels.get(t.releaseId)?.tracklist?.find((x) => x.position === t.position)?.duration);
  const job = "free-vibes";
  jobUpdate(job, { label: opts.audio ? "Vibes, Energie & Audio-Analyse" : "Vibes & Energie", done: 0, total: todo.length });
  let changed = 0;
  try {
    let done = 0;
    // Zwei Tracks gleichzeitig: Download und Analyse überlappen sich
    await pool(todo, 2, async (t) => {
      const patch: Partial<TrackMeta> = {};
      let tags: TagsResp["tags"] = [];
      if (lastfm) {
        try {
          tags = (await api<TagsResp>(`/api/lastfm/tags?artist=${encodeURIComponent(t.artist)}&track=${encodeURIComponent(t.title)}`)).tags;
        } catch {
          /* kein Treffer */
        }
      }
      let analysis: AudioAnalysis | null = null;
      if (opts.audio && !t.analyzedAt && (t.analyzeTries ?? 0) < 3) {
        let failed = false;
        try {
          // Erwartetes Tempo aus den anderen Tracks der Platte oder den Styles: verhindert Halb-/Doppel-Fehler
          const siblings = all.filter((x) => x.releaseId === t.releaseId && x.id !== t.id && x.bpm).map((x) => x.bpm!);
          const expectedBpm = estimateBpm(rels.get(t.releaseId)?.styles ?? [], siblings);
          analysis = await analyzePreview(t.artist, t.title, durationOf(t), t.deezerId, { expectedBpm });
        } catch (e) {
          failed = true;
          console.warn("Analyse", t.id, e);
        }
        if (!failed) patch.analyzedAt = Date.now();
        else patch.analyzeTries = (t.analyzeTries ?? 0) + 1;
        if (analysis) {
          patch.audioEnergy = analysis.energy;
          // Gemessene Werte nur übernehmen, wenn sie sicher genug sind und nichts Besseres da ist
          if (!t.bpm && analysis.bpm && analysis.bpmConfidence >= 0.35) {
            patch.bpm = Math.round(analysis.bpm);
            patch.bpmSource = "Analyse";
          }
          if (!t.key && analysis.key && analysis.keyConfidence >= 0.3) {
            patch.key = analysis.key;
            patch.keySource = "Analyse (Schätzung)";
          }
        }
      }
      const manual = t.vibeSource === "manuell";
      if (!manual) {
        const v = estimateVibe({
          styles: rels.get(t.releaseId)?.styles ?? [],
          bpm: patch.bpm ?? t.bpm,
          tags,
          audioEnergy: patch.audioEnergy ?? t.audioEnergy,
        });
        patch.energy = v.energy;
        patch.moods = [...new Set([...v.moods, v.slot])];
        patch.vibeSource = v.sources.join(" + ");
      }
      await autoUpdateTrack(t.id, patch);
      changed++;
      jobUpdate(job, { done: ++done });
    });
  } finally {
    jobUpdate(job, null);
  }
  return changed;
}
