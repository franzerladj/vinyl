// Barcode-Erkennung: native BarcodeDetector (Android/Chrome), sonst ZXing nur für EAN/UPC.
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { BrowserMultiFormatOneDReader } from "@zxing/browser";
import { validBarcode } from "../../../shared/barcode";

interface NativeDetector {
  detect(src: CanvasImageSource | ImageBitmap): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> };
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
let nativeP: Promise<NativeDetector | null> | null = null;

function native(): Promise<NativeDetector | null> {
  nativeP ??= (async () => {
    try {
      if (!window.BarcodeDetector) return null;
      const sup = await window.BarcodeDetector.getSupportedFormats();
      const f = FORMATS.filter((x) => sup.includes(x));
      return f.length ? new window.BarcodeDetector({ formats: f }) : null;
    } catch {
      return null;
    }
  })();
  return nativeP;
}

let zx: BrowserMultiFormatOneDReader | null = null;
function zxing() {
  if (!zx) {
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    zx = new BrowserMultiFormatOneDReader(hints);
  }
  return zx;
}

/** UPC-E und Co. auf gültige Ziffern bringen; null wenn die Prüfziffer nicht stimmt */
function clean(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 6 || d.length === 7) return d; // UPC-E ohne Prüfung, Discogs findet es trotzdem
  return validBarcode(d) ? d : null;
}

function zxingCanvas(c: HTMLCanvasElement): string | null {
  try {
    return clean(zxing().decodeFromCanvas(c).getText());
  } catch {
    return null;
  }
}

function toCanvas(src: CanvasImageSource, sw: number, sh: number, crop?: { x: number; y: number; w: number; h: number }, max = 1400) {
  const r = crop ?? { x: 0, y: 0, w: sw, h: sh };
  const scale = Math.min(1, max / Math.max(r.w, r.h));
  const c = document.createElement("canvas");
  c.width = Math.round(r.w * scale);
  c.height = Math.round(r.h * scale);
  c.getContext("2d", { willReadFrequently: true })!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

/** Barcode aus einem Foto lesen (mehrere Größen, weil ZXing bei sehr großen Bildern schlechter wird) */
export async function decodeBarcodeImage(bmp: ImageBitmap): Promise<string | null> {
  const det = await native();
  if (det) {
    try {
      const r = await det.detect(bmp);
      for (const x of r) {
        const c = clean(x.rawValue);
        if (c) return c;
      }
    } catch {
      /* weiter mit ZXing */
    }
  }
  for (const max of [1400, 900, 2200]) {
    const c = zxingCanvas(toCanvas(bmp, bmp.width, bmp.height, undefined, max));
    if (c) return c;
  }
  return null;
}

export interface LiveScan {
  stop(): void;
  torch?: (on: boolean) => Promise<void>;
  engine: "nativ" | "zxing";
}

/** Startet die Rückkamera und meldet den ersten sicher gelesenen Code */
export async function startLiveScan(video: HTMLVideoElement, onCode: (code: string) => void): Promise<LiveScan> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  const track = stream.getVideoTracks()[0];
  const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
  if (caps.focusMode?.includes("continuous")) {
    await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
  }
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play().catch(() => {});

  const det = await native();
  let stopped = false;
  let last = "";
  let timer = 0;
  const loop = async () => {
    if (stopped) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      let code: string | null = null;
      if (det) {
        try {
          const r = await det.detect(video);
          code = r.map((x) => clean(x.rawValue)).find(Boolean) ?? null;
        } catch {
          /* nächster Frame */
        }
      } else {
        // Mittleren Bereich ausschneiden: schneller und weniger Fehllesungen
        code = zxingCanvas(toCanvas(video, w, h, { x: w * 0.08, y: h * 0.2, w: w * 0.84, h: h * 0.6 }, 1100));
      }
      // ZXing liest gelegentlich falsch: denselben Code zweimal hintereinander verlangen
      if (code && (det || code === last)) {
        stopped = true;
        onCode(code);
        return;
      }
      last = code ?? last;
    }
    timer = window.setTimeout(loop, det ? 120 : 60);
  };
  void loop();

  return {
    engine: det ? "nativ" : "zxing",
    stop() {
      stopped = true;
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
    torch: caps.torch ? (on) => track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }) : undefined,
  };
}
