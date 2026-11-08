/** Authenticated WebSocket management against a real isolated server, without a model request. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

test("browser MCP requests persist in their workspace and report missing runtime support honestly", async () => {
  const root = await makeWorkspace();
  const home = path.join(root, "isolated-home");
  await fs.mkdir(home);
  const server = await startServer(root, { sandbox: false, noExtensions: true }, { env: { HOME: home, USERPROFILE: home } });
  const client = connect(server.wsUrl());
  try {
    await client.open();
    await client.waitFor("hello");
    let sequence = 0;
    const request = async (operation) => {
      const requestId = `mcp-test-${++sequence}`;
      client.send({ type: "mcp_management", requestId, operation });
      return client.waitFor((message) => message.type === "mcp_management_result" && message.requestId === requestId);
    };
    const listed = await request({ action: "list" });
    assert.equal(listed.error, undefined);
    assert.deepEqual(listed.data.servers, []);
    assert.match(listed.data.statusError, /no MCP management gateway/);
    const doc = listed.data.documents.find((entry) => entry.scope === "project");
    const saved = await request({ action: "save", name: "test-server", scope: "project", revision: doc.revision, config: { url: "https://example.test/mcp" } });
    assert.equal(saved.reloadRequired, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, ".mcp.json"), "utf8")).mcpServers["test-server"].url, "https://example.test/mcp");
    const stale = await request({ action: "remove", name: "test-server", scope: "project", revision: doc.revision });
    assert.match(stale.error, /changed; refresh/);
    const rejected = await request({ action: "tool", tool: "anything" });
    assert.match(rejected.error, /Unknown MCP management operation/);
    const oversized = await request({ action: "save", name: "large", scope: "project", revision: "", config: { command: "node", args: ["x".repeat(256 * 1024)] } });
    assert.match(oversized.error, /too large/);
    const removed = await request({ action: "remove", name: "test-server", scope: "project", revision: saved.data.documents.find((entry) => entry.scope === "project").revision });
    assert.equal(removed.error, undefined);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, ".mcp.json"), "utf8")).mcpServers["test-server"], undefined);
  } finally { client.close(); await server.stop(); }
});

test("sandbox policy refuses MCP writes at the real browser boundary", async () => {
  const root = await makeWorkspace();
  const home = path.join(root, "isolated-home");
  await fs.mkdir(home);
  const server = await startServer(root, { noExtensions: true }, { env: { HOME: home, USERPROFILE: home } });
  const client = connect(server.wsUrl());
  try {
    await client.open(); await client.waitFor("hello");
    client.send({ type: "mcp_management", requestId: "locked", operation: { action: "save", name: "server", scope: "project", revision: "", config: { command: "node" } } });
    const reply = await client.waitFor((message) => message.type === "mcp_management_result" && message.requestId === "locked");
    assert.match(reply.error, /locked/);
    await assert.rejects(fs.access(path.join(root, ".mcp.json")));
  } finally { client.close(); await server.stop(); }
});

test("MCP mutations reserve the workspace before a turn or session restart can start", async () => {
  const root = await makeWorkspace();
  const home = path.join(root, "isolated-home"); await fs.mkdir(home);
  const server = await startServer(root, { sandbox: false, noExtensions: true }, { env: { HOME: home, USERPROFILE: home } });
  const first = connect(server.wsUrl()), second = connect(server.wsUrl());
  try {
    await first.open(); await first.waitFor("hello"); await second.open(); await second.waitFor("hello");
    first.send({ type: "mcp_management", requestId: "list", operation: { action: "list" } });
    const listed = await first.waitFor((m) => m.type === "mcp_management_result" && m.requestId === "list");
    // One socket preserves arrival order; the second checks shared persisted state.
    first.send({ type: "mcp_management", requestId: "save", operation: { action: "save", scope: "project", name: "server", revision: listed.data.documents.find((d) => d.scope === "project").revision, config: { url: "https://example.test/mcp" } } });
    first.send({ type: "prompt", text: "must not start a model request" });
    first.send({ type: "restart_session" });
    const refused = await first.waitFor((m) => m.type === "error");
    assert.match(refused.message, /change already in progress/);
    const restartRefused = await first.waitFor((m) => m.type === "error" && /before restarting/.test(m.message));
    assert.match(restartRefused.message, /working or changing/);
    const saved = await first.waitFor((m) => m.type === "mcp_management_result" && m.requestId === "save");
    assert.equal(saved.error, undefined);
    assert.ok(!first.received.some((m) => m.type === "user_message" && m.text === "must not start a model request"));
    second.send({ type: "mcp_management", requestId: "after", operation: { action: "list" } });
    const after = await second.waitFor((m) => m.type === "mcp_management_result" && m.requestId === "after");
    assert.ok(after.data.documents.find((d) => d.scope === "project").servers.server);
  } finally { first.close(); second.close(); await server.stop(); }
});
