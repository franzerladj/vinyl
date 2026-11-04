// Hörproben-Analyse im Hintergrund-Thread, damit die Oberfläche flüssig bleibt
import { analyzeSamples, type AnalysisHints } from "../../../shared/audioAnalysis";

self.onmessage = (e: MessageEvent<{ id: number; samples: Float32Array; sr: number; hints?: AnalysisHints }>) => {
  const { id, samples, sr, hints } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: analyzeSamples(samples, sr, hints) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
