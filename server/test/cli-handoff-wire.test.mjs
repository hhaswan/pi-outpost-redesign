import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Normal cross-platform server suites use the source harness; deploy gates exercise the distributable.
const entry = process.env.CLI_HANDOFF_TEST_ENTRY ? path.resolve(repository, process.env.CLI_HANDOFF_TEST_ENTRY) : undefined;
const store = pathToFileURL(path.join(repository, "shared", "src", "cliHandoffStore.ts")).href;
const seed = "Exact released terminal history; never fork this session";

async function fixture(t) {
  // The harness removes each server root on stop; the project and CLI file must survive it.
  const data = await makeWorkspace();
  const stops = [];
  t.after(async () => {
    await Promise.all(stops.map(stop => stop()));
    await fs.rm(data, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
  const cwd = path.join(data, "project");
  const handoffs = path.join(data, "handoffs");
  const bridges = path.join(data, "bridges");
  await fs.mkdir(cwd);
  await fs.mkdir(bridges, { mode: 0o700 });
  return { data, cwd: await fs.realpath(cwd), handoffs, bridges, stops };
}

async function release(f, cwd = f.cwd) {
  const saved = SessionManager.create(cwd, path.join(f.data, `external-cli-${randomUUID()}`));
  saved.appendMessage({ role: "user", content: [{ type: "text", text: seed }], timestamp: Date.now() });
  const sessionFile = await fs.realpath(saved.getSessionFile());
  const input = { bridgeId: randomUUID(), cwd, sessionId: saved.getSessionId(), sessionFile };
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { createCliHandoff } from ${JSON.stringify(store)}; console.log(JSON.stringify(await createCliHandoff(${JSON.stringify(input)}, ${JSON.stringify(f.handoffs)})));`],
  { cwd: repository, env: { ...process.env, PI_OFFLINE: "1", NODE_V8_COVERAGE: "" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`receipt child exited ${code}/${signal}: ${stderr}`)));
  });
  const receipt = JSON.parse(stdout.trim());
  assert.equal(receipt.pid, child.pid, "receipt must retain the actual releasing process PID");
  assert.throws(() => process.kill(receipt.pid, 0), { code: "ESRCH" });
  assert.equal(receipt.sessionFile, sessionFile);
  return { ...receipt, bytes: await fs.readFile(sessionFile) };
}

async function boot(t, f, { sandbox = false, cancel = false, failure = false, bridge = false, lock } = {}) {
  const root = await makeWorkspace();
  const audit = path.join(root, "opened.jsonl");
  const veto = path.join(root, "cancel-resume");
  const missing = path.join(root, "hide-source-before-resume");
  const extension = path.join(root, "observe-session.mjs");
  if (cancel) await fs.writeFile(veto, "cancel");
  if (failure) await fs.writeFile(missing, "hide");
  // Observe the real SDK file, not just a listing that could conceal a fork.
  await fs.writeFile(extension, `import { appendFileSync, existsSync, renameSync } from 'node:fs';
export default function (pi) {
  pi.on('session_before_switch', event => {
    if (event.reason !== 'resume') return;
    if (existsSync(${JSON.stringify(missing)})) renameSync(event.targetSessionFile, event.targetSessionFile + '.unavailable');
    if (existsSync(${JSON.stringify(veto)})) return { cancel: true };
  });
  pi.on('session_start', (_event, ctx) => appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ id: ctx.sessionManager.getSessionId(), file: ctx.sessionManager.getSessionFile() }) + '\\n'));
}
`);
  const server = await startServer(root, {
    cwd: f.cwd, agentDir: path.join(root, "agent"),
    sandbox: sandbox ? { root: f.cwd, allowWrite: true, writableRoot: f.cwd, allowBash: false } : false,
    noExtensions: false, extensionPaths: [extension, ...(bridge ? [path.join(repository, "extensions", "cli-session-bridge.ts")] : [])], ...(lock ? { [lock]: true } : {}),
  }, { entry, env: { PI_OUTPOST_HANDOFF_DIR: f.handoffs, PI_OUTPOST_BRIDGE_DIR: f.bridges, ANTHROPIC_API_KEY: "test-offline-no-model-requests", PI_OFFLINE: "1" } });
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await server.stop(); } };
  f.stops.push(stop);
  t.after(stop);
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.open();
  const hello = await client.waitFor(m => m.type === "hello" && !m.agentStarting && !!m.sessionId, 30_000);
  return { server, client, hello, audit, veto, missing, stop };
}

async function request(client, operation) {
  const requestId = randomUUID();
  client.send({ type: "cli_bridge", requestId, operation });
  return client.waitFor(m => m.type === "cli_bridge_result" && m.requestId === requestId, 20_000);
}

async function sessions(client) {
  const since = client.received.length;
  client.send({ type: "list_sessions" });
  return (await client.waitFor(m => client.received.indexOf(m) >= since && m.type === "sessions", 20_000)).sessions;
}

async function opened(web) {
  return (await fs.readFile(web.audit, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function assertContinued(web, receipt, since = 0) {
  const replaced = await web.client.waitFor(m => web.client.received.indexOf(m) >= since && m.type === "session_replaced" && m.sessionId === receipt.sessionId, 20_000);
  assert.ok(JSON.stringify(replaced.items).includes(seed), "original transcript must reach the browser");
  const observed = (await opened(web)).at(-1);
  assert.equal(observed.id, receipt.sessionId);
  assert.equal(await fs.realpath(observed.file), receipt.sessionFile, "runtime must open the canonical original file, not a fork");
  const listed = (await sessions(web.client)).filter(s => s.id === receipt.sessionId);
  assert.equal(listed.length, 1);
  assert.equal(await fs.realpath(listed[0].path), receipt.sessionFile);
  const marker = `Exact-file continuation ${randomUUID()}`;
  const beforeRename = web.client.received.length;
  web.client.send({ type: "rename_session", path: listed[0].path, name: marker });
  await web.client.waitFor(m => web.client.received.indexOf(m) >= beforeRename && m.type === "sessions" && m.sessions.some(s => s.id === receipt.sessionId && s.name === marker), 20_000);
  const entries = (await fs.readFile(receipt.sessionFile, "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.ok(entries.some(record => record.type === "session_info" && record.name === marker), "no-model rename must persist to the original JSONL file");
}

async function assertRefused(web, receipt) {
  const since = web.client.received.length;
  const result = await request(web.client, { action: "resume", id: receipt.id });
  assert.ok(result.error, JSON.stringify(result));
  assert.notEqual(result.resumed, true);
  assert.equal(web.client.received.slice(since).some(m => m.type === "session_replaced"), false, "refusal must not publish a false replacement");
  assert.equal((await opened(web)).at(-1).id, web.hello.sessionId, "refusal must preserve the web conversation");
  return result;
}

test("ContinueExactReleasedFile: Terminal sessions adopts the original ID and canonical file without a fork", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const web = await boot(t, f);
  const listed = await request(web.client, { action: "list" });
  assert.equal(listed.error, undefined);
  assert.deepEqual(listed.handoffs.find(h => h.id === receipt.id), { id: receipt.id, cwd: f.cwd, sessionId: receipt.sessionId, state: "ready" });
  const since = web.client.received.length;
  web.client.send({ type: "switch_session", path: receipt.sessionFile });
  await web.client.waitFor(m => web.client.received.indexOf(m) >= since && m.type === "error", 20_000);
  assert.equal(web.client.received.slice(since).some(m => m.type === "session_replaced"), false, "initial adoption must require Terminal sessions");
  const result = await request(web.client, { action: "resume", id: receipt.id });
  assert.equal(result.resumed, true, JSON.stringify(result));
  await assertContinued(web, receipt, since);
  const openedBefore = (await opened(web)).length;
  const bytesBefore = await fs.readFile(receipt.sessionFile);
  assert.equal((await request(web.client, { action: "resume", id: receipt.id })).resumed, true);
  assert.equal((await opened(web)).length, openedBefore, "an idempotent retry must not recreate the runtime");
  assert.deepEqual(await fs.readFile(receipt.sessionFile), bytesBefore);
});

test("ConcurrentWebAcquisition: two server processes cannot open the same released CLI file", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const first = await boot(t, f);
  const second = await boot(t, f);
  const webs = [first, second];
  const results = await Promise.all(webs.map(web => request(web.client, { action: "resume", id: receipt.id })));
  assert.equal(results.filter(result => result.resumed === true).length, 1, JSON.stringify(results));
  const winner = results.findIndex(result => result.resumed === true);
  await assertContinued(webs[winner], receipt);
  const loser = webs[1 - winner];
  assert.ok(results[1 - winner].error);
  assert.equal(loser.client.received.some(m => m.type === "session_replaced" && m.sessionId === receipt.sessionId), false);
  assert.equal((await opened(loser)).some(record => record.id === receipt.sessionId || record.file === receipt.sessionFile), false, "loser must never open the original file");
  const persisted = JSON.parse(await fs.readFile(path.join(f.handoffs, `${receipt.id}.json`), "utf8"));
  assert.ok(Number.isInteger(persisted.owner.pid));
  assert.notEqual(persisted.owner.pid, receipt.pid);
  assert.doesNotThrow(() => process.kill(persisted.owner.pid, 0));
});

test("RecoverAfterWebRestart: a new server lists and switches the adopted external file", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const first = await boot(t, f);
  assert.equal((await request(first.client, { action: "resume", id: receipt.id })).resumed, true);
  await assertContinued(first, receipt);
  first.client.close();
  await first.stop();
  assert.ok((await fs.stat(receipt.sessionFile)).isFile());
  const second = await boot(t, f);
  const listed = await sessions(second.client);
  const adopted = listed.find(s => s.id === receipt.sessionId);
  assert.ok(adopted, "normal list_sessions must recover receipts owned by a dead web process");
  assert.equal(await fs.realpath(adopted.path), receipt.sessionFile);
  assert.notEqual(adopted.readOnlyCliHistory, true);
  const since = second.client.received.length;
  second.client.send({ type: "switch_session", path: adopted.path });
  await assertContinued(second, receipt, since);
});

test("CancelledSwitchIsNotContinuation: SDK cancellation preserves the current session and permits same-workspace retry", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const web = await boot(t, f, { cancel: true });
  await assertRefused(web, receipt);
  await assertRefused(web, receipt);
  assert.deepEqual(await fs.readFile(receipt.sessionFile), receipt.bytes);
  assert.ok((await request(web.client, { action: "list" })).handoffs.some(h => h.id === receipt.id));
  await fs.rm(web.veto);
  const since = web.client.received.length;
  const result = await request(web.client, { action: "resume", id: receipt.id });
  assert.equal(result.resumed, true, JSON.stringify(result));
  await assertContinued(web, receipt, since);
});

test("UnsafeOrCrossProjectReceipt: other cwd and tampered session headers are refused without changing source bytes", async t => {
  const f = await fixture(t);
  const other = path.join(f.data, "other-project");
  await fs.mkdir(other);
  const crossProject = await release(f, await fs.realpath(other));
  const tampered = await release(f);
  const lines = tampered.bytes.toString("utf8").split(/\r?\n/);
  const header = JSON.parse(lines[0]);
  lines[0] = JSON.stringify({ ...header, id: randomUUID() });
  await fs.writeFile(tampered.sessionFile, lines.join("\n"));
  const unsafeBytes = await fs.readFile(tampered.sessionFile);
  const web = await boot(t, f);
  const listed = await request(web.client, { action: "list" });
  assert.equal(listed.error, undefined);
  assert.equal(listed.handoffs.some(h => h.id === crossProject.id), false);
  await assertRefused(web, crossProject);
  await assertRefused(web, tampered);
  assert.deepEqual(await fs.readFile(crossProject.sessionFile), crossProject.bytes);
  assert.deepEqual(await fs.readFile(tampered.sessionFile), unsafeBytes);
});

test("SandboxDeniesContinuation: a released receipt does not bypass the sandbox", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const web = await boot(t, f, { sandbox: true });
  await assertRefused(web, receipt);
  assert.ok((await request(web.client, { action: "list" })).error);
  assert.deepEqual(await fs.readFile(receipt.sessionFile), receipt.bytes);
});

test("StaleCliClaimStillBlocksContinuation: dead receipt PID does not override a private terminal registration", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const id = randomUUID();
  await fs.writeFile(path.join(f.bridges, `${id}.json`), JSON.stringify({ version: 1, id, port: 1, token: "x".repeat(64), cwd: f.cwd, sessionId: receipt.sessionId, sessionFile: receipt.sessionFile }), { mode: 0o600 });
  const web = await boot(t, f);
  await assertRefused(web, receipt);
  assert.deepEqual(await fs.readFile(receipt.sessionFile), receipt.bytes);
});

test("HostPolicyDeniesContinuation: extension-lock and workspace-lock also refuse released receipts", async t => {
  for (const lock of ["extensionLock", "workspaceLock"]) {
    const f = await fixture(t);
    const receipt = await release(f);
    const web = await boot(t, f, { lock });
    await assertRefused(web, receipt);
    assert.deepEqual(await fs.readFile(receipt.sessionFile), receipt.bytes);
  }
});

test("SideWorkspaceCannotAcquireTransferredFile: a side session cannot strand a dead prior main-owner lease", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const prior = await boot(t, f);
  assert.equal((await request(prior.client, { action: "resume", id: receipt.id })).resumed, true);
  await prior.stop();
  const next = await boot(t, f);
  const sourceBeforeSide = await fs.readFile(receipt.sessionFile);
  const leasePath = path.join(f.handoffs, `${receipt.id}.json`);
  const leaseBeforeSide = await fs.readFile(leasePath);
  const before = next.client.received.length;
  next.client.send({ type: "open_side_session", root: f.cwd });
  const side = await next.client.waitFor(m => next.client.received.indexOf(m) >= before && m.type === "workspace_switched" && !m.agentStarting && m.workspace?.id && m.workspace.id !== f.cwd, 30_000);
  assert.ok(side.sessionId);
  const since = next.client.received.length;
  next.client.send({ type: "switch_session", path: receipt.sessionFile });
  const denied = await next.client.waitFor(m => next.client.received.indexOf(m) >= since && m.type === "error", 20_000);
  assert.match(denied.message, /main workspace/);
  assert.equal(next.client.received.slice(since).some(m => m.type === "session_replaced"), false);
  assert.equal((await request(next.client, { action: "resume", id: receipt.id })).resumed, undefined);
  assert.deepEqual(await fs.readFile(receipt.sessionFile), sourceBeforeSide);
  assert.deepEqual(await fs.readFile(leasePath), leaseBeforeSide);
});

test("FailedSwitchIsNotContinuation: source disappears after lease validation and the SDK fallback is not acknowledged as the original session", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const web = await boot(t, f, { failure: true });
  const since = web.client.received.length;
  const refused = await request(web.client, { action: "resume", id: receipt.id });
  assert.ok(refused.error);
  assert.notEqual(refused.resumed, true);
  assert.equal(web.client.received.slice(since).some(m => m.type === "session_replaced" && m.sessionId === receipt.sessionId), false);
  assert.deepEqual(await fs.readFile(receipt.sessionFile + ".unavailable"), receipt.bytes);
  assert.notEqual((await opened(web)).at(-1).id, receipt.sessionId);
  await fs.rm(web.missing);
  await fs.rename(receipt.sessionFile + ".unavailable", receipt.sessionFile);
  const retrySince = web.client.received.length;
  assert.equal((await request(web.client, { action: "resume", id: receipt.id })).resumed, true);
  await assertContinued(web, receipt, retrySince);
});

test("WebLoadedCliBridgeDoesNotVetoHandoff: the real bridge loaded in RPC mode allows its authorized web owner to resume", async t => {
  const f = await fixture(t);
  const receipt = await release(f);
  const web = await boot(t, f, { bridge: true });
  assert.deepEqual(await fs.readdir(f.bridges), [], "web mode must not publish a terminal owner");
  const since = web.client.received.length;
  const reply = await request(web.client, { action: "resume", id: receipt.id });
  assert.equal(reply.resumed, true, JSON.stringify(reply));
  await assertContinued(web, receipt, since);
  assert.deepEqual(await fs.readdir(f.bridges), [], "resumed web mode must remain outside CLI enrollment");
});
