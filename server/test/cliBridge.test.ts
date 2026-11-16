import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { abortCli, findCliOwner, manageCliBridge, isCliSessionClaimed, routeToCli } from "../src/cliBridge.ts";
import type { CliBridgeOperation } from "../../shared/src/cliBridge.ts";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-bridge-"));
  const directory = path.join(root, "registry");
  await mkdir(directory, { mode: 0o700 });
  const id = randomUUID();
  const token = "private".repeat(8);
  const sessionFile = path.join(root, "session.jsonl");
  await writeFile(sessionFile, "{}");
  const state = { instanceId: id, generation: "generation-1", cwd: root, sessionId: "session-1", sessionFile,
    activity: "idle", inputGranted: true, transcript: "Existing conversation", truncated: false };
  const calls: { url: string | undefined; auth: string | undefined; body: string }[] = [];
  let response: unknown;
  let status = 200;
  let hang = false;
  let postResponse: unknown;
  let postStatus = 200;
  let postHang = false;
  let onSnapshot: (() => Promise<void>) | undefined;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, auth: req.headers.authorization, body });
    if (hang || (req.url === "/submit" && postHang)) return;
    if (req.url === "/snapshot") await onSnapshot?.();
    res.writeHead(req.url === "/submit" ? postStatus : status, { "content-type": "application/json", location: "http://example.com/" });
    const value = req.url === "/submit" ? postResponse : response;
    res.end(typeof value === "string" ? value : JSON.stringify(value ?? (req.url === "/snapshot" ? state : { submitted: true })));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const owner = { version: 1, id, token, port: address.port, cwd: root, sessionId: state.sessionId, sessionFile };
  const file = path.join(directory, `${id}.json`);
  const save = async (value: unknown = owner) => writeFile(file, JSON.stringify(value), { mode: 0o600 });
  await save();
  const run = (operation: CliBridgeOperation) => manageCliBridge(operation, { enabled: true, directory });
  const submit = () => run({ action: "submit", id, generation: state.generation, inputId: "input-1", text: "hello" });
  return { root, directory, id, file, owner, state, calls, run, save, submit,
    setResponse(value: unknown) { response = value; }, setStatus(value: number) { status = value; },
    setPost(value: unknown, code = 200, stalls = false) { postResponse = value; postStatus = code; postHang = stalls; },
    setHang() { hang = true; }, setSnapshotHook(hook: () => Promise<void>) { onSnapshot = hook; },
    async cleanup() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
}

test("EnrolledCliDiscovery / ObserveAndReconnect / GrantAndSubmit: authenticated owner only, no credentials returned", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const listed = await f.run({ action: "list" });
  assert.deepEqual(listed.sessions, [{ id: f.id, cwd: f.root, sessionId: "session-1", activity: "idle", inputGranted: true }]);
  assert(!JSON.stringify(listed).includes(f.owner.token));
  assert(!JSON.stringify(listed).includes('"port"'));
  assert.deepEqual((await f.run({ action: "read", id: f.id })).snapshot, f.state);
  f.state.transcript = "New conversation";
  assert.equal((await f.run({ action: "read", id: f.id })).snapshot?.transcript, "New conversation");
  assert.deepEqual(await f.submit(), { submitted: true });
  assert(f.calls.every(call => call.auth === `Bearer ${f.owner.token}`));
  const posts = f.calls.filter(call => call.url === "/submit");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0]!.body), { generation: "generation-1", inputId: "input-1", text: "hello" });
});

test("disabled operations never inspect unsafe registry or contact owner", async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.save({ hostile: true });
  for (const operation of [{ action: "list" }, { action: "read", id: f.id }, { action: "submit", id: f.id }] as CliBridgeOperation[]) {
    assert.match((await manageCliBridge(operation, { enabled: false, directory: f.directory })).error!, /disabled/);
  }
  assert.equal(f.calls.length, 0);
});

test("PrivateBridgeBoundary: hostile registrations, identifiers and excessive registry entries fail closed", async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const change of [{ port: "http://example.com" }, { port: 0 }, { port: 65536 }, { token: "bad\r\nheader" }, { id: randomUUID() }, { url: "http://example.com" }]) {
    await f.save({ ...f.owner, ...change });
    assert((await f.run({ action: "list" })).error);
    await assert.rejects(isCliSessionClaimed(f.owner.sessionFile, f.directory));
  }
  await writeFile(f.file, "x".repeat(16385));
  assert((await f.run({ action: "read", id: f.id })).error);
  await f.save();
  for (const operation of [{ action: "other" }, { action: "read", id: "../secrets" }, null]) {
    assert((await f.run(operation as CliBridgeOperation)).error);
  }
  assert.equal(f.calls.length, 0);
  await Promise.all(Array.from({ length: 256 }, async () => { const id = randomUUID(); await writeFile(path.join(f.directory, `${id}.json`), JSON.stringify({ ...f.owner, id }), { mode: 0o600 }); }));
  assert((await f.run({ action: "list" })).error);
  await assert.rejects(isCliSessionClaimed(f.owner.sessionFile, f.directory));
});

test("PrivateBridgeBoundary: malformed, oversized, redirected and mismatched snapshots never escape", async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const value of ["not json", "x".repeat(512 * 1024 + 1), { ...f.state, instanceId: randomUUID() }, { ...f.state, cwd: os.tmpdir() }, { ...f.state, sessionId: "other" }, { ...f.state, sessionFile: undefined }, { ...f.state, token: f.owner.token }, { ...f.state, inputGranted: "true" }]) {
    f.setResponse(value);
    const reply = await f.run({ action: "read", id: f.id });
    assert(reply.error); assert(!reply.snapshot); assert(!JSON.stringify(reply).includes(f.owner.token));
  }
  f.setResponse(undefined); f.setStatus(302);
  assert((await f.run({ action: "read", id: f.id })).error);
  const before = f.calls.length;
  assert.equal((await f.run({ action: "list" })).sessions?.[0]?.activity, "unreachable");
  assert.equal(f.calls.length, before + 1);
});

test("identity changed during snapshot cannot return stale list/read", async t => {
  const f = await fixture(); t.after(f.cleanup);
  f.setSnapshotHook(async () => { await f.save({ ...f.owner, sessionId: "changed" }); });
  assert((await f.run({ action: "read", id: f.id })).error);
  await f.save();
  assert((await f.run({ action: "list" })).error);
});

test("RefuseUnsafeInput: command, oversized UTF-8, stale, busy and ungranted inputs never POST", async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const text of [" /command", "\n!shell", "", " ", "x".repeat(8001), "界".repeat(8000), "\0"]) {
    assert((await f.run({ action: "submit", id: f.id, generation: f.state.generation, inputId: "id", text })).error);
  }
  assert.equal(f.calls.length, 0);
  assert((await f.run({ action: "submit", id: f.id, generation: "stale", inputId: "id", text: "hi" })).error);
  f.state.activity = "waiting"; assert((await f.submit()).error);
  f.state.activity = "idle"; f.state.inputGranted = false; assert((await f.submit()).error);
  assert.equal(f.calls.filter(call => call.url === "/submit").length, 0);
});

test("POST refusal, redirect, hostile acknowledgement and timeout are never retried", async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const [value, status, hangs] of [[{ submitted: false }, 200, false], [{ submitted: true, token: f.owner.token }, 200, false], ["x".repeat(16385), 200, false], [{ submitted: true }, 302, false], [{ error: "busy" }, 409, false], [undefined, 200, true]] as const) {
    f.setPost(value, status, hangs);
    const before = f.calls.filter(call => call.url === "/submit").length;
    const result = await f.submit();
    assert(result.error); assert(!result.submitted);
    assert(!JSON.stringify(result).includes(f.owner.token));
    assert.equal(f.calls.filter(call => call.url === "/submit").length, before + 1);
  }
});

test("UnreachableOwner: timeout disables input and retains claim", async t => {
  const f = await fixture(); t.after(f.cleanup); f.setHang();
  const start = Date.now();
  const reply = await f.run({ action: "list" });
  assert(Date.now() - start < 3000);
  assert.equal(reply.sessions?.[0]?.activity, "unreachable");
  assert.equal(reply.sessions?.[0]?.inputGranted, false);
  assert.equal(await isCliSessionClaimed(f.owner.sessionFile, f.directory), true);
});

test("ClaimedHistoryCannotBeMutated: canonical aliases and absent registry", async t => {
  const f = await fixture(); t.after(f.cleanup);
  assert.equal(await isCliSessionClaimed(f.owner.sessionFile, path.join(f.root, "missing")), false);
  assert.equal(await isCliSessionClaimed(path.join(f.root, "unclaimed"), f.directory), false);
  const alias = path.join(f.root, "alias.jsonl");
  try { await symlink(f.owner.sessionFile, alias); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("symlinks require Windows privilege"); return; } throw error; }
  assert.equal(await isCliSessionClaimed(alias, f.directory), true);
  await f.save({ ...f.owner, sessionFile: alias });
  assert.equal(await isCliSessionClaimed(f.owner.sessionFile, f.directory), true);
});

test("registry symlinks and POSIX non-private modes fail closed", async t => {
  const f = await fixture(); t.after(f.cleanup);
  if (process.platform !== "win32") {
    for (const target of [f.directory, f.file]) {
      await chmod(target, target === f.directory ? 0o755 : 0o644);
      assert((await f.run({ action: "list" })).error);
      await assert.rejects(isCliSessionClaimed(f.owner.sessionFile, f.directory));
      await chmod(target, target === f.directory ? 0o700 : 0o600);
    }
  }
  const content = await readFile(f.file);
  const outside = path.join(f.root, "outside.json"); await writeFile(outside, content, { mode: 0o600 });
  await rm(f.file);
  try { await symlink(outside, f.file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("symlinks require Windows privilege"); return; } throw error; }
  assert((await f.run({ action: "list" })).error);
  await assert.rejects(isCliSessionClaimed(f.owner.sessionFile, f.directory));
  const alias = path.join(f.root, "registry-alias"); await symlink(f.directory, alias, "junction");
  assert((await manageCliBridge({ action: "list" }, { enabled: true, directory: alias })).error);
});

test("atomic private temporary registrations do not interrupt discovery", async t => {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.directory, `.${randomUUID()}-${randomUUID()}.tmp`), "not yet published", { mode: 0o600 });
  const listed = await f.run({ action: "list" });
  assert.equal(listed.sessions?.length, 1);
  assert.equal(listed.sessions?.[0].id, f.id);
});

// openlore: scenario=RefusedRouteFallsBackToWeb spec=shared-cli-web-sessions
// openlore: scenario=UnknownRouteOutcomeIsNotResent spec=shared-cli-web-sessions
test("routeToCli: fallback only when the owner provably did not take the text", async t => {
  const f = await fixture(); t.after(f.cleanup);
  const owner = await findCliOwner(f.owner.sessionFile, f.directory);
  assert.equal(owner?.id, f.id);
  const route = () => routeToCli(owner!, "hello", "input-1", f.directory);
  const posts = () => f.calls.filter(call => call.url === "/submit").length;
  f.state.activity = "working";
  assert.deepEqual(await route(), { outcome: "submitted" }, "a working CLI takes it as a follow-up");
  assert.equal(JSON.parse(f.calls.at(-1)!.body).generation, "generation-1");
  f.state.activity = "idle";
  f.setPost({ error: "Input revoked" }, 403);
  assert.deepEqual(await route(), { outcome: "fallback" });
  f.setPost({ error: "Submission uncertain; inspect terminal", uncertain: true }, 409);
  assert.equal((await route()).outcome, "error");
  f.setPost({ error: "Owner is waiting on the terminal" }, 409);
  assert.equal((await route()).outcome, "error", "a refusal that is not a revoke never runs the prompt elsewhere");
  f.setPost(undefined, 200, true);
  assert.equal((await route()).outcome, "error", "a lost answer is an unknown outcome");
  const before = posts();
  f.state.inputGranted = false;
  assert.deepEqual(await route(), { outcome: "fallback" });
  f.state.inputGranted = true; f.state.activity = "waiting";
  assert.equal((await route()).outcome, "error");
  assert.equal(posts(), before, "revoked or waiting owners are never posted to");
  f.state.activity = "idle";
  await f.cleanup();
  assert.deepEqual(await route(), { outcome: "fallback" }, "a closed CLI is gone");
  assert.equal(await abortCli(owner!), false);
});

test("abortCli: posts /abort with the owner credential", async t => {
  const f = await fixture(); t.after(f.cleanup);
  f.setPost({ aborted: true });
  assert.equal(await abortCli(f.owner as never), true);
  assert.equal(f.calls.at(-1)!.url, "/abort");
  assert.equal(f.calls.at(-1)!.auth, `Bearer ${f.owner.token}`);
});
