// Login-Start gegen eine echte Bereitstellung: Request-Token muss direkt vom Browser kommen
// BASE=https://login-test.crate-8vf.pages.dev node tools/e2e/login.cjs
const { chromium, devices } = require("playwright");
(async () => {
  const base = process.env.BASE ?? "https://crate-8vf.pages.dev";
  const b = await chromium.launch();
  const results = [];
  for (let run = 0; run < Number(process.env.RUNS ?? 5); run++) {
    const ctx = await b.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    const seen = [];
    page.on("request", (r) => /oauth\/request_token|api\/auth/.test(r.url()) && seen.push(r.url().replace(/\?.*/, "")));
    const status = [];
    page.on("response", (r) => /oauth\/request_token/.test(r.url()) && status.push(r.status()));
    await page.goto(base + "/");
    await page.click("text=Mit Discogs anmelden");
    const t0 = Date.now();
    await page.waitForURL(/discogs\.com\/(oauth\/authorize|login)|login=/, { timeout: 45000 }).catch(() => {});
    results.push({ run, ms: Date.now() - t0, landed: page.url().replace(/oauth_token=[^&]+/, "oauth_token=…").slice(0, 80), direct: !seen.some((u) => u.endsWith("/api/auth/login")), requestTokenStatus: status });
    await ctx.close();
  }
  console.log(results);
  await b.close();
})();
