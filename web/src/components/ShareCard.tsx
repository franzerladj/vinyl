// Vorschau einer Teilen-Karte mit „Teilen“ (Teilen-Menü des Handys, z. B. Instagram-Story) oder Speichern
import { useEffect, useState } from "react";
import { Sheet } from "./bits";
import { saveImage, shareImage, shareToStory, storyDirect } from "../lib/shareCard";
import { toast } from "../lib/store";
import { appInfo } from "../lib/push";

export function ShareCardSheet({ open, onClose, make, filename, title }: { open: boolean; onClose: () => void; make: () => Promise<Blob>; filename: string; text?: string; title: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const direct = storyDirect();
  const oldApp = appInfo().android && !direct;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBlob(null);
    setError(null);
    make().then(
      (b) => {
        if (!alive) return;
        setBlob(b);
        setUrl(URL.createObjectURL(b));
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack share-card">
        <b style={{ fontSize: 18 }}>{title}</b>
        <div className="share-preview">{url ? <img src={url} alt="Vorschau der Karte" /> : <span className="sub">{error ?? "Karte wird gestaltet …"}</span>}</div>
        {/* Das Bild hat Story-Format (1080 × 1920). Das Teilen-Menü des Handys öffnet sich direkt mit dem Bild. */}
        <button
          className="btn primary block lg"
          disabled={!blob || busy}
          onClick={async () => {
            setBusy(true);
            const r = await shareToStory(blob!, filename).finally(() => setBusy(false));
            if (r === "downloaded") toast("Bild gespeichert");
            if (r !== "cancelled") onClose();
          }}
        >
          {busy ? "Wird vorbereitet …" : direct ? "In die Instagram-Story" : "In die Story teilen"}
        </button>
        {direct && (
          <button className="btn block" disabled={!blob} onClick={async () => (await shareImage(blob!, filename)) !== "cancelled" && onClose()}>
            Woanders teilen
          </button>
        )}
        <button
          className="btn block"
          disabled={!blob}
          onClick={() => {
            saveImage(blob!, filename);
            toast("Bild gespeichert");
          }}
        >
          Bild sichern
        </button>
        {oldApp && (
          <a className="tiny" style={{ textAlign: "center" }} href="/download/crate.apk">
            Mit der neuen App-Version geht es direkt in die Instagram-Story. Hier laden und installieren.
          </a>
        )}
        <span className="tiny" style={{ textAlign: "center" }}>{direct ? "Öffnet direkt den Story-Editor von Instagram." : "Im Menü „Instagram“ wählen, dann „Story“. Geht genauso mit WhatsApp-Status."}</span>
      </div>
    </Sheet>
  );
}
