/**
 * PairingCodeExpires at the wire: a code is refused once its two minutes have passed.
 * Its own file so the wait runs beside the other suites, not after them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeWorkspace, startServer } from "./harness.mjs";

const TOKEN = "pairing-expiry-token";

test("PairingCodeExpires: a code older than two minutes is refused and sets no cookie", { timeout: 240_000 }, async () => {
  const server = await startServer(await makeWorkspace(), { server: { token: TOKEN } });
  try {
    const post = (route, body) => fetch(`${server.base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.base, Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    const { code, expiresAt } = await (await post("/api/pair/create", {})).json();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt - Date.now()) + 1500));
    const late = await fetch(`${server.base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json", Origin: server.base }, body: JSON.stringify({ code }) });
    assert.equal(late.status, 401);
    assert.equal(late.headers.get("set-cookie"), null);
  } finally {
    await server.stop();
  }
});
