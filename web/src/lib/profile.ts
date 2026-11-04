// Eigenes Crate-Profil laden/speichern und Profile von Freunden abrufen (mit Zwischenspeicher fürs Offline-Ansehen)
import { getKV, setKV } from "./db";
import type { CrateProfile } from "../../../shared/profile";

const req = async <T,>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { message?: string }).message ?? `Fehler ${r.status}`);
  return r.json() as Promise<T>;
};

export async function loadMyProfile(): Promise<CrateProfile | null> {
  try {
    const { profile } = await req<{ profile: CrateProfile | null }>("/api/profile/me");
    await setKV("crateProfile:me", profile);
    return profile;
  } catch {
    return getKV<CrateProfile | null>("crateProfile:me", null);
  }
}

export async function saveMyProfile(p: CrateProfile): Promise<CrateProfile | null> {
  const { profile } = await req<{ profile: CrateProfile | null }>("/api/profile/me", p);
  await setKV("crateProfile:me", profile);
  return profile;
}

export async function loadProfile(u: string): Promise<CrateProfile | null> {
  const key = `crateProfile:${u.toLowerCase()}`;
  try {
    const { profile } = await req<{ profile: CrateProfile | null }>(`/api/profile/${encodeURIComponent(u)}`);
    await setKV(key, profile);
    return profile;
  } catch {
    return getKV<CrateProfile | null>(key, null);
  }
}
