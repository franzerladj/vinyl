import { describe, expect, it } from "vitest";
import { app } from "../server/app";
import { seal } from "../server/session";

const SECRET = "f".repeat(40);
const ORIGIN = "https://crate.test";
const env = { SESSION_SECRET: SECRET, APP_URL: ORIGIN };
const cookie = async (username: string, verified = true) => `crate_session=${await seal(SECRET, { token: "t", secret: "s", username, verified, iat: Date.now() })}`;
const post = async (user: string, path: string, body: unknown, verified = true) =>
  app.request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", Cookie: await cookie(user, verified) }, body: JSON.stringify(body) }, env);
const social = async (user: string) => (await app.request(`${ORIGIN}/api/friends`, { headers: { Cookie: await cookie(user) } }, env)).json();

describe("Freundschaften", () => {
  it("Anfrage, Annehmen: beide sind befreundet", async () => {
    expect(await (await post("Anna1", "/api/friends/request", { to: "bert1" })).json()).toEqual({ status: "angefragt" });
    expect((await social("bert1")).in.map((x: { from: string }) => x.from)).toEqual(["Anna1"]);
    expect((await social("anna1")).out).toEqual(["bert1"]);
    expect(await (await post("bert1", "/api/friends/respond", { from: "anna1", accept: true })).json()).toEqual({ status: "befreundet" });
    const a = await social("Anna1"), b = await social("bert1");
    expect(a).toEqual({ friends: ["anna1".replace("anna1", "bert1")], in: [], out: [] });
    expect(b.friends).toHaveLength(1);
    expect(b.in).toEqual([]);
  });
  it("gegenseitige Anfrage macht sofort Freunde", async () => {
    await post("carl2", "/api/friends/request", { to: "dora2" });
    expect(await (await post("dora2", "/api/friends/request", { to: "carl2" })).json()).toEqual({ status: "befreundet" });
    expect((await social("carl2")).friends).toEqual(["dora2"]);
    expect((await social("carl2")).out).toEqual([]);
  });
  it("Ablehnen und Entfernen räumen beide Seiten auf", async () => {
    await post("emil3", "/api/friends/request", { to: "fritz3" });
    expect(await (await post("fritz3", "/api/friends/respond", { from: "emil3", accept: false })).json()).toEqual({ status: "abgelehnt" });
    expect(await social("emil3")).toEqual({ friends: [], in: [], out: [] });
    await post("emil3", "/api/friends/request", { to: "fritz3" });
    await post("fritz3", "/api/friends/respond", { from: "emil3", accept: true });
    await post("emil3", "/api/friends/remove", { user: "fritz3" });
    expect((await social("fritz3")).friends).toEqual([]);
  });
  it("nur angemeldet und bestätigt, keine Anfrage an sich selbst, keine erfundene Zusage", async () => {
    expect((await app.request(`${ORIGIN}/api/friends`, {}, env)).status).toBe(401);
    expect((await post("gabi4", "/api/friends/request", { to: "hans4" }, false)).status).toBe(401);
    expect((await post("gabi4", "/api/friends/request", { to: "GABI4" })).status).toBe(400);
    expect((await post("gabi4", "/api/friends/request", { to: "../x" })).status).toBe(400);
    expect((await post("gabi4", "/api/friends/respond", { from: "hans4", accept: true })).status).toBe(404);
  });
});
