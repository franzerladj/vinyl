// Zeitplan für Push-Mitteilungen: stößt stündlich /api/push/run der Pages-App an.
// Die eigentliche Arbeit (Wants prüfen, Erinnerungen) passiert dort, mit Zugriff auf KV und Secrets.
interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      fetch(`${env.APP_URL}/api/push/run`, { method: "POST", headers: { "X-Cron-Secret": env.CRON_SECRET } }).then(async (r) => {
        console.log("push/run", r.status, (await r.text()).slice(0, 300));
      }),
    );
  },
  // Manuell auslösen ist absichtlich nicht möglich
  async fetch() {
    return new Response("crate-cron", { status: 404 });
  },
};
