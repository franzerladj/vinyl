/** Arbeitet eine Liste mit begrenzter Parallelität ab. Fehler einzelner Einträge stoppen nichts. */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await fn(items[i], i);
      } catch (e) {
        console.warn("pool", e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/** Kleines Protokoll der letzten Sync-Fehler (für die Einstellungen und zur Fehlersuche) */
import { getKV, setKV } from "./db";
export interface LogEntry {
  at: number;
  step: string;
  message: string;
}
export async function logError(step: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const log = await getKV<LogEntry[]>("syncLog", []);
  await setKV("syncLog", [{ at: Date.now(), step, message: msg }, ...log].slice(0, 30));
}
