// Vorschau einer Teilen-Karte mit „Teilen“ (Teilen-Menü des Handys, z. B. Instagram-Story) oder Speichern
import { useEffect, useState } from "react";
import { Sheet } from "./bits";
import { shareImage } from "../lib/shareCard";
import { toast } from "../lib/store";

export function ShareCardSheet({ open, onClose, make, filename, text, title }: { open: boolean; onClose: () => void; make: () => Promise<Blob>; filename: string; text?: string; title: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        <button
          className="btn primary block"
          disabled={!blob}
          onClick={async () => {
            const r = await shareImage(blob!, filename, text);
            if (r === "downloaded") toast("Bild gespeichert");
            if (r !== "cancelled") onClose();
          }}
        >
          Teilen
        </button>
        <span className="tiny" style={{ textAlign: "center" }}>Im Teilen-Menü „Instagram“ und dann „Story“ wählen, oder als Bild sichern.</span>
      </div>
    </Sheet>
  );
}
