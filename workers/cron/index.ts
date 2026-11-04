// Zeitplan für Push-Mitteilungen: alle 10 Minuten. Holt die Liste der Nutzer mit Mitteilungen und
// stößt für jeden einen eigenen Prüf-Aufruf an (jeder Aufruf hat sein eigenes Anfrage-Budget).
// Die eigentliche Arbeit passiert in der Pages-App (/api/push/run), mit Zugriff auf KV und Secrets.
interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const headers = { "X-Cron-Secret": env.CRON_SECRET };
    ctx.waitUntil(
      (async () => {
        const r = await fetch(`${env.APP_URL}/api/push/users`, { method: "POST", headers });
        if (!r.ok) return console.log("push/users", r.status);
        const { users } = (await r.json()) as { users: string[] };
        // Worker dürfen ~50 Unteranfragen: höchstens 45 Nutzer pro Runde, 6 gleichzeitig
        const list = users.slice(0, 45);
        let i = 0;
        const worker = async () => {
          while (i < list.length) {
            const u = list[i++];
            const res = await fetch(`${env.APP_URL}/api/push/run?u=${encodeURIComponent(u)}`, { method: "POST", headers }).catch(() => null);
            console.log("push/run", u, res?.status);
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
      })(),
    );
  },
  async fetch() {
    return new Response("crate-cron", { status: 404 });
  },
};
