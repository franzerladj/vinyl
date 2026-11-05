// Ein Gerät, ein Konto: meldet sich ein anderes Discogs-Konto an, werden die lokalen Daten
// des vorherigen Kontos entfernt (Sammlung, Sets, Notizen, Freunde, eigener Schlüssel, Push-Abo).
import { db, getKV, setKV } from "./db";

/** Öffentliche Discogs-Daten dürfen bleiben, alles Persönliche nicht */
const KEEP = new Set(["releases"]);

export async function claimDevice(username: string): Promise<boolean> {
  const me = username.toLowerCase();
  const owner = await getKV<string | null>("owner", null);
  if (owner === me) return false;
  if (owner) {
    await Promise.all(db.tables.filter((t) => !KEEP.has(t.name)).map((t) => t.clear()));
    try {
      localStorage.removeItem("crate_anthropic_key");
      for (const k of Object.keys(localStorage)) if (k.startsWith("crate:hint:")) localStorage.removeItem(k);
    } catch {
      /* egal */
    }
    // Das Push-Abo dieses Geräts gehört noch dem vorherigen Konto
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      /* egal */
    }
  }
  await setKV("owner", me);
  return Boolean(owner);
}
