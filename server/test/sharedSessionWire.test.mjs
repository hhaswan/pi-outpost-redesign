/**
 * One session file written by Outpost web and the Pi CLI at once (shared-cli-web-sessions).
 * The "CLI" here is a second SessionManager appending to the same file, exactly as the
 * terminal's SDK does; scripts/check-shared-session.mjs drives a real terminal.
 */
import assert from "node:assert/strict";
import { appendFile, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/queued-prompts-provider.mjs", import.meta.url));
const MODEL = { provider: "queue-test", id: "queue-test" };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], api: "x", provider: "x", model: "x", usage, stopReason: "stop", timestamp: Date.now() });
const cliDirectory = (agentDir, cwd) => path.join(agentDir, "sessions", `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
const entries = async (file) => (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const requests = async (log) => (await readFile(log, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

function next(client, predicate, timeoutMs = 30_000) {
  const seen = client.received.length;
  return client.waitFor((message) => client.received.indexOf(message) >= seen && predicate(message), timeoutMs);
}

// openlore: scenario=NewWebSessionsLandInTheCliDirectory spec=shared-cli-web-sessions
// openlore: scenario=CliTurnAppearsInWebWithoutRefresh spec=shared-cli-web-sessions
// openlore: scenario=WebPromptChainsAfterCliEntries spec=shared-cli-web-sessions
// openlore: scenario=NoSyncDuringATurn spec=shared-cli-web-sessions
test("web and a CLI writer share one session file: live sync when idle, chained prompts, nothing mid-turn", async (t) => {
  const root = await realpath(await makeWorkspace());
  const log = path.join(root, "requests.jsonl");
  const gates = path.join(root, "gate");
  const server = await startServer(root, { extensionPaths: [PROVIDER], allowedModels: [MODEL] }, { env: { QUEUE_LOG: log, QUEUE_GATES: gates } });
  const client = connect(server.wsUrl());
  t.after(async () => {
    client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const hello = await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");

  client.send({ type: "prompt", text: "first from web" });
  await next(client, (m) => m.type === "agent_end");
  client.send({ type: "list_sessions" });
  const listed = await next(client, (m) => m.type === "sessions");
  const file = listed.sessions.find((s) => s.id === hello.sessionId)?.path;
  assert.ok(file, "the web session is listed");
  assert.equal(path.dirname(file), cliDirectory(path.join(root, ".pi-agent"), root), "new web sessions are written where the CLI lists them");

  // The CLI appends a turn while web is idle: web shows it without a refresh or a new session.
  const cli = SessionManager.open(file);
  cli.appendMessage(user("typed in the cli"));
  const cliLast = cli.appendMessage(assistant("cli answer"));
  const synced = await next(client, (m) => m.type === "session_synced", 10_000);
  assert.equal(synced.sessionId, hello.sessionId);
  assert.ok(synced.items.some((item) => item.kind === "user" && item.text === "typed in the cli"));
  assert.equal(client.received.some((m) => m.type === "session_replaced"), false, "no session transition");

  // The next web prompt reaches the model with the CLI's turn and chains after it.
  client.send({ type: "prompt", text: "second from web" });
  await next(client, (m) => m.type === "agent_end");
  const second = (await requests(log)).at(-1);
  assert.deepEqual(second.users.map((u) => u.text), ["first from web", "typed in the cli", "second from web"]);
  const written = await entries(file);
  assert.equal(written.find((e) => e.type === "message" && e.message.role === "user" && e.message.content[0].text === "second from web").parentId, cliLast);

  // A CLI append during a web turn is not read mid-turn; it arrives once the turn is over.
  await writeFile(`${gates}-3`, "");
  client.send({ type: "prompt", text: "held" });
  await next(client, (m) => m.type === "agent_start");
  const during = client.received.length;
  SessionManager.open(file).appendMessage(user("cli during web turn"));
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  assert.equal(client.received.slice(during).some((m) => m.type === "session_synced"), false, "never re-read during a turn");
  await rm(`${gates}-3`);
  await next(client, (m) => m.type === "agent_end");
  const late = await next(client, (m) => m.type === "session_synced", 10_000);
  assert.ok(late.items.length > 0);
  for (const line of await entries(file)) assert.ok(line.type, "every line still parses");
});

// openlore: scenario=CliHistoryIsSelectable spec=shared-cli-web-sessions
test("a Pi CLI session of the project can be renamed and opened from web", async (t) => {
  const root = await realpath(await makeWorkspace());
  const directory = cliDirectory(path.join(root, ".pi-agent"), root);
  const saved = SessionManager.create(root, directory);
  saved.appendMessage(user("question asked in the terminal"));
  saved.appendMessage(assistant("terminal answer"));
  const file = saved.getSessionFile();
  const server = await startServer(root, { extensionPaths: [PROVIDER], allowedModels: [MODEL] });
  const client = connect(server.wsUrl());
  t.after(async () => {
    client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  await client.waitFor("hello", 30_000);
  client.send({ type: "list_sessions" });
  const listed = await next(client, (m) => m.type === "sessions");
  assert.ok(listed.sessions.some((s) => s.path === file), JSON.stringify(listed.sessions) + file);
  client.send({ type: "rename_session", path: file, name: "Renamed from web" });
  const renamed = await next(client, (m) => m.type === "error" || (m.type === "sessions" && m.sessions.some((s) => s.path === file && s.name === "Renamed from web")), 5000);
  assert.notEqual(renamed.type, "error", renamed.message);
  client.send({ type: "switch_session", path: file });
  const replaced = await next(client, (m) => m.type === "session_replaced" || m.type === "error").then((m) => { assert.notEqual(m.type, "error", m.message); return m; });
  assert.equal(replaced.sessionId, saved.getSessionId());
  assert.ok(replaced.items.some((item) => item.kind === "user" && item.text === "question asked in the terminal"));
});

// openlore: scenario=OtherWritersBranchIsFollowed spec=shared-cli-web-sessions
test("a writer appending under an older entry makes a branch: the file parses, web re-reads it, the tree lists both, the next prompt chains after it", async (t) => {
  const root = await realpath(await makeWorkspace());
  const log = path.join(root, "requests.jsonl");
  const server = await startServer(root, { extensionPaths: [PROVIDER], allowedModels: [MODEL] }, { env: { QUEUE_LOG: log } });
  const client = connect(server.wsUrl());
  t.after(async () => {
    client.close();
    await server.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const hello = await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  for (const text of ["one", "two"]) {
    client.send({ type: "prompt", text });
    await next(client, (m) => m.type === "agent_end");
  }
  client.send({ type: "list_sessions" });
  const file = (await next(client, (m) => m.type === "sessions")).sessions.find((s) => s.id === hello.sessionId).path;
  const before = await entries(file);
  const firstAnswer = before.find((e) => e.type === "message" && e.message.role === "assistant").id;

  // The other writer never saw "two": its turn hangs off the first answer.
  const at = new Date().toISOString();
  const branchUser = { type: "message", id: "branch01", parentId: firstAnswer, timestamp: at, message: user("cli on a stale leaf") };
  const branchAnswer = { type: "message", id: "branch02", parentId: "branch01", timestamp: at, message: assistant("cli branch answer") };
  await appendFile(file, `${JSON.stringify(branchUser)}\n${JSON.stringify(branchAnswer)}\n`);
  const synced = await next(client, (m) => m.type === "session_synced", 10_000);
  assert.deepEqual(synced.items.filter((item) => item.kind === "user").map((item) => item.text), ["one", "cli on a stale leaf"]);

  client.send({ type: "list_tree" });
  const tree = await next(client, (m) => m.type === "tree");
  const forks = [];
  const walk = (nodes) => nodes.forEach((node) => { if (node.children.length > 1) forks.push(node.children.map((child) => child.text)); walk(node.children); });
  walk(tree.roots);
  assert.deepEqual(forks.map((texts) => [...texts].sort()), [["cli on a stale leaf", "two"]], "both branches are listed");

  client.send({ type: "prompt", text: "three" });
  await next(client, (m) => m.type === "agent_end");
  assert.deepEqual((await requests(log)).at(-1).users.map((u) => u.text), ["one", "cli on a stale leaf", "three"]);
  const after = await entries(file);
  assert.equal(after.find((e) => e.type === "message" && e.message.role === "user" && e.message.content[0].text === "three").parentId, "branch02");
  assert.ok(after.some((e) => e.type === "message" && e.message.role === "user" && e.message.content[0].text === "two"), "the web branch is kept");
});
