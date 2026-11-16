import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

// openlore: scenario=ClaimedHistoryCannotBeMutated spec=cli-session-bridge
test("ClaimedHistoryCannotBeMutated: an enrolled CLI's open file is not deleted; rename is shared", async () => {
  const root = await makeWorkspace();
  const registry = path.join(root, "private-bridges");
  await fs.mkdir(registry, { mode: 0o700 });
  const server = await startServer(root, { sandbox: false, noExtensions: true }, { env: { PI_OUTPOST_BRIDGE_DIR: registry } });
  const client = connect(server.wsUrl());
  try {
    await client.open();
    const hello = await client.waitFor("hello");
    const saved = SessionManager.create(root, path.join(root, ".pi-agent", "sessions"));
    saved.appendMessage({ role: "user", content: [{ type: "text", text: "Terminal-owned history" }], timestamp: Date.now() });
    const file = saved.getSessionFile();
    const original = await fs.readFile(file, "utf8");
    const id = randomUUID();
    await fs.writeFile(path.join(registry, `${id}.json`), JSON.stringify({ version: 1, id, port: 1, token: "x".repeat(64), cwd: root, sessionId: saved.getSessionId(), sessionFile: file }), { mode: 0o600 });
    // Deleting under a running writer would lose its next append; opening or renaming is shared.
    const previous = client.received.length;
    client.send({ type: "delete_session", path: file });
    const reply = await client.waitFor(message => message.type === "error" && client.received.indexOf(message) >= previous);
    assert.match(reply.message, /Pi CLI has this session open/);
    assert.equal(await fs.readFile(file, "utf8"), original);
    client.send({ type: "rename_session", path: file, name: "renamed while the CLI has it" });
    await client.waitFor(message => message.type === "sessions" && message.sessions.some(s => s.path === file && s.name === "renamed while the CLI has it"));
    client.send({ type: "cli_bridge", requestId: "list-owners", operation: { action: "list" } });
    const list = await client.waitFor(message => message.type === "cli_bridge_result" && message.requestId === "list-owners");
    assert.equal(list.sessions[0].activity, "unreachable");
    assert.equal(JSON.stringify(list).includes("x".repeat(64)), false);
    assert.equal("port" in list.sessions[0], false);
  } finally { client.close(); await server.stop(); }
});

test("PrivateBridgeBoundary: sandbox refuses external CLI discovery at the browser boundary", async () => {
  const root = await makeWorkspace();
  const server = await startServer(root, { noExtensions: true });
  const client = connect(server.wsUrl());
  try {
    await client.open(); await client.waitFor("hello");
    client.send({ type: "cli_bridge", requestId: "locked", operation: { action: "list" } });
    const reply = await client.waitFor(message => message.type === "cli_bridge_result" && message.requestId === "locked");
    assert.ok(reply.error);
    assert.equal(reply.sessions, undefined);
  } finally { client.close(); await server.stop(); }
});
