// Hörproben-Analyse im Hintergrund-Thread, damit die Oberfläche flüssig bleibt
import { analyzeSamples } from "../../../shared/audioAnalysis";

self.onmessage = (e: MessageEvent<{ id: number; samples: Float32Array; sr: number }>) => {
  const { id, samples, sr } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: analyzeSamples(samples, sr) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
