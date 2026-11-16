import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

// openlore: scenario=WebPromptRunsInLiveCli spec=shared-cli-web-sessions
// openlore: scenario=CliTurnStreamsToWeb spec=shared-cli-web-sessions
// openlore: scenario=WebStopAbortsCliTurn spec=shared-cli-web-sessions
// openlore: scenario=RefusedRouteFallsBackToWeb spec=shared-cli-web-sessions
// openlore: scenario=UnknownRouteOutcomeIsNotResent spec=shared-cli-web-sessions
test("a web prompt goes to the live CLI on the same file, streams back, stops there, and falls back only on a clear refusal", async (t) => {
  const root = await fs.realpath(await makeWorkspace());
  const registry = path.join(root, "private-bridges");
  await fs.mkdir(registry, { mode: 0o700 });
  const log = path.join(root, "requests.jsonl");
  const PROVIDER = fileURLToPath(new URL("./fixtures/queued-prompts-provider.mjs", import.meta.url));
  const MODEL = { provider: "queue-test", id: "queue-test" };
  const server = await startServer(root, { sandbox: false, extensionPaths: [PROVIDER], allowedModels: [MODEL] }, { env: { PI_OUTPOST_BRIDGE_DIR: registry, QUEUE_LOG: log } });
  const client = connect(server.wsUrl());
  const requests = async () => (await fs.readFile(log, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const next = (predicate, timeoutMs = 15_000) => {
    const seen = client.received.length;
    const waiting = new Error(`timed out waiting for ${predicate}`);
    return client.waitFor((message) => client.received.indexOf(message) >= seen && predicate(message), timeoutMs).catch(() => { throw waiting; });
  };
  // The fake bridged CLI: the extension's private HTTP contract, recording what it is sent.
  const calls = [];
  const listeners = new Set();
  let post = { status: 200, body: { submitted: true } };
  let state;
  const bridge = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, body });
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write("\n");
      listeners.add(res);
      res.on("close", () => listeners.delete(res));
      return;
    }
    res.writeHead(req.url === "/snapshot" ? 200 : req.url === "/abort" ? 200 : post.status, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url === "/snapshot" ? state : req.url === "/abort" ? { aborted: true } : post.body));
  });
  const emit = (event) => { for (const res of listeners) res.write(JSON.stringify(event) + "\n"); };
  t.after(async () => {
    client.close();
    bridge.closeAllConnections(); bridge.close();
    await server.stop();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  await client.open();
  const hello = await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "first from web" });
  await next((m) => m.type === "agent_end", 30_000);
  client.send({ type: "list_sessions" });
  const file = (await next((m) => m.type === "sessions")).sessions.find((s) => s.id === hello.sessionId).path;

  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const id = randomUUID();
  const token = "t".repeat(64);
  state = { instanceId: id, generation: "g1", cwd: root, sessionId: hello.sessionId, sessionFile: file, activity: "idle", inputGranted: true, transcript: "", truncated: false };
  await fs.writeFile(path.join(registry, `${id}.json`), JSON.stringify({ version: 1, id, port: bridge.address().port, token, cwd: root, sessionId: hello.sessionId, sessionFile: file }), { mode: 0o600 });
  // The server follows the CLI's live events once its sweep finds the registration.
  const until = Date.now() + 10_000;
  while (!listeners.size && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(listeners.size, 1, "the server follows the bridged CLI's events");

  // Routed: the CLI gets the text, the web runtime runs nothing, the user bubble shows at once.
  const before = (await requests()).length;
  client.send({ type: "prompt", text: "routed to the cli" });
  const echoed = await next((m) => m.type === "user");
  assert.equal(echoed.text, "routed to the cli");
  const submit = calls.find((call) => call.url === "/submit");
  assert.deepEqual({ ...JSON.parse(submit.body), inputId: "x" }, { generation: "g1", inputId: "x", text: "routed to the cli" });
  // The CLI answers: streamed live, then the file sync shows what it wrote.
  emit({ type: "agent_start" });
  await next((m) => m.type === "agent_start");
  emit({ type: "assistant_start" });
  emit({ type: "block_delta", block: "text", contentIndex: 0, delta: "cli says hi" });
  const delta = await next((m) => m.type === "block_delta");
  assert.equal(delta.delta, "cli says hi");
  // A client binding mid-turn (a page reload) sees the turn running and its reply so far, once,
  // still streaming, so the next delta extends it rather than opening a second bubble.
  const late = connect(server.wsUrl());
  t.after(() => late.close());
  await late.open();
  const joined = await late.waitFor("hello");
  assert.equal(joined.isStreaming, true, "busy for the CLI's turn");
  assert.equal(joined.items.filter((item) => item.kind === "user" && item.text === "routed to the cli").length, 1);
  const partials = joined.items.filter((item) => item.kind === "assistant" && item.blocks.some((b) => b.text.includes("cli says hi")));
  assert.equal(partials.length, 1, "exactly one partial reply");
  assert.deepEqual({ ...joined.items.at(-1), blocks: joined.items.at(-1).blocks.map((b) => b.text) }, { kind: "assistant", blocks: ["cli says hi"], streaming: true });
  const extended = next((m) => m.type === "block_delta" && m.delta === " again");
  emit({ type: "block_delta", block: "text", contentIndex: 0, delta: " again" });
  assert.equal((await late.waitFor((m) => m.type === "block_delta")).delta, " again");
  await extended;
  assert.equal(listeners.size, 1, "one event subscription per workspace, whatever the number of clients");
  emit({ type: "tool_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
  assert.equal((await next((m) => m.type === "tool_start")).toolCallId, "c1");
  emit({ type: "tool_end", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "listing" }], isError: false });
  assert.equal((await next((m) => m.type === "tool_end")).text, "listing");
  const cli = SessionManager.open(file);
  cli.appendMessage({ role: "user", content: [{ type: "text", text: "routed to the cli" }], timestamp: Date.now() });
  cli.appendMessage({ role: "assistant", content: [{ type: "text", text: "cli says hi" }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  emit({ type: "assistant_end", message: { role: "assistant", content: [{ type: "text", text: "cli says hi again" }], stopReason: "stop" } });
  await next((m) => m.type === "assistant_end");
  // Joining after the reply ended and a tool ran: the finished reply and card, no streaming item.
  const later = connect(server.wsUrl());
  t.after(() => later.close());
  await later.open();
  const rejoined = await later.waitFor("hello");
  assert.equal(rejoined.isStreaming, true);
  assert.deepEqual(rejoined.items.slice(-3).map((item) => item.kind), ["user", "assistant", "tool"]);
  assert.equal(rejoined.items.filter((item) => item.kind === "assistant" && item.streaming).length, 0);
  assert.equal(rejoined.items.filter((item) => item.kind === "assistant" && item.blocks.some((b) => b.text === "cli says hi again")).length, 1);
  assert.equal(rejoined.items.find((item) => item.kind === "tool" && item.toolCallId === "c1")?.output, "listing");
  // Alone again: with other tabs watching, a conversation change below would open a side session.
  late.close(); later.close();
  await new Promise((resolve) => setTimeout(resolve, 200));
  // Both armed before the end: they may arrive in one read.
  const ended = next((m) => m.type === "agent_end");
  const syncing = next((m) => m.type === "session_synced");
  emit({ type: "agent_end" });
  await ended;
  const synced = await syncing;
  assert.ok(synced.items.some((item) => item.kind === "assistant" && item.blocks.some((b) => b.text === "cli says hi")));
  assert.equal((await requests()).length, before, "the web runtime ran no turn for the routed prompt");

  // Stop while the CLI runs reaches the CLI, not the idle web runtime.
  emit({ type: "agent_start" });
  await next((m) => m.type === "agent_start");
  client.send({ type: "abort" });
  const deadline = Date.now() + 5_000;
  while (!calls.some((call) => call.url === "/abort") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(calls.some((call) => call.url === "/abort"), "Stop reached the CLI");
  emit({ type: "agent_end" });
  await next((m) => m.type === "agent_end");

  // Outcome unknown: an error, never a second send through the web runtime.
  post = { status: 409, body: { error: "Submission uncertain; inspect terminal", uncertain: true } };
  client.send({ type: "prompt", text: "maybe received" });
  assert.match((await next((m) => m.type === "error")).message, /check the terminal/);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await requests()).length, before, "no duplicate through the web runtime");
  assert.equal(calls.filter((call) => call.url === "/submit").length, 2);

  // Monkey: the web starts another conversation mid CLI turn; the CLI's stream does not follow it there.
  emit({ type: "agent_start" });
  await next((m) => m.type === "agent_start");
  client.send({ type: "new_session" });
  await next((m) => m.type === "session_replaced");
  const after = client.received.length;
  emit({ type: "assistant_start" });
  emit({ type: "block_delta", block: "text", contentIndex: 0, delta: "leaked into the new conversation" });
  emit({ type: "agent_end" });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(client.received.slice(after).some((m) => m.type === "block_delta" || m.type === "assistant_start"), false, "no CLI stream in another conversation");
  client.send({ type: "switch_session", path: file });
  await next((m) => m.type === "session_replaced");
  const relink = Date.now() + 10_000;
  while (listeners.size !== 1 && Date.now() < relink) await new Promise((resolve) => setTimeout(resolve, 50));

  // Revoked between snapshot and send: the web runtime answers instead, once.
  post = { status: 403, body: { error: "Input revoked" } };
  client.send({ type: "prompt", text: "revoked so web answers" });
  await next((m) => m.type === "agent_end", 30_000);
  assert.equal((await requests()).filter((r) => r.users.at(-1).text === "revoked so web answers").length, 1);

  // The CLI closed: the web runtime answers.
  bridge.closeAllConnections();
  await new Promise((resolve) => bridge.close(resolve));
  client.send({ type: "prompt", text: "cli is gone" });
  await next((m) => m.type === "agent_end", 30_000);
  assert.equal((await requests()).filter((r) => r.users.at(-1).text === "cli is gone").length, 1);
  assert.equal(calls.filter((call) => call.url === "/submit").length, 3, "nothing was sent to a closed CLI");
});
