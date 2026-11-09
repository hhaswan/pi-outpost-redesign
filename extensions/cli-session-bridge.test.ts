import { test } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bridge from "./cli-session-bridge.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cli-bridge-"));
  const directory = join(root, "registry");
  const old = process.env.PI_OUTPOST_BRIDGE_DIR;
  const oldHandoff = process.env.PI_OUTPOST_HANDOFF_DIR;
  const handoffDirectory = join(root, "handoffs");
  process.env.PI_OUTPOST_BRIDGE_DIR = directory;
  process.env.PI_OUTPOST_HANDOFF_DIR = handoffDirectory;
  const handlers = new Map<string, Function>();
  let command: Function;
  let idle = true;
  let confirm = true;
  let sessionId = randomUUID();
  let shutdowns = 0;
  let pendingMessages = false;
  let confirmHook: (() => void) | undefined;
  const sent: string[] = [];
  let entries: unknown[] = [{ type: "message", message: { role: "user", content: "hello" } }];
  const context = {
    mode: "tui", cwd: root, isIdle: () => idle, hasPendingMessages: () => pendingMessages,
    shutdown: () => { shutdowns++; },
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => join(root, `${sessionId}.jsonl`), getBranch: () => entries },
    ui: { notify() {}, confirm: async () => { confirmHook?.(); return confirm; } },
  };
  bridge({ on: (name: string, fn: Function) => handlers.set(name, fn), registerCommand: (_: string, options: { handler: Function }) => { command = options.handler; }, sendUserMessage: (text: string) => { sent.push(text); } } as unknown as ExtensionAPI);
  if (old === undefined) delete process.env.PI_OUTPOST_BRIDGE_DIR; else process.env.PI_OUTPOST_BRIDGE_DIR = old;
  if (oldHandoff === undefined) delete process.env.PI_OUTPOST_HANDOFF_DIR; else process.env.PI_OUTPOST_HANDOFF_DIR = oldHandoff;
  const emit = async (name: string, event = {}) => handlers.get(name)?.(event, context);
  await emit("session_start");
  const file = join(directory, readdirSync(directory)[0]);
  const registration = JSON.parse(readFileSync(file, "utf8"));
  const url = `http://127.0.0.1:${registration.port}`;
  const request = (route: string, body?: unknown, auth = registration.token) => fetch(url + route, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${auth}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const snapshot = async () => (await request("/snapshot")).json();
  return { root, directory, handoffDirectory, file, registration, sent, emit, request, snapshot,
    handoff: () => command!("handoff", context), shutdowns: () => shutdowns,
    pendingMessages: (value: boolean) => { pendingMessages = value; },
    confirmHook: (hook: () => void) => { confirmHook = hook; },
    persist: () => { const file = join(root, `${sessionId}.jsonl`); writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: sessionId, cwd: root }) + "\n"); return file; },
    allow: () => command!("allow", context), revoke: () => command!("revoke", context),
    idle: (value: boolean) => { idle = value; }, confirm: (value: boolean) => { confirm = value; },
    entries: (value: unknown[]) => { entries = value; }, session: (value: string) => { sessionId = value; },
    close: async () => { await emit("session_shutdown"); rmSync(root, { recursive: true, force: true }); },
  };
}

test("EnrolledCliDiscovery / PrivateBridgeBoundary: authenticated loopback, private files, no factory writes", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/snapshot", undefined, "wrong")).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${f.registration.port}/snapshot`, { headers: { Authorization: `Bearer ${f.registration.token}`, Origin: "https://untrusted.invalid" } })).status, 401);
    assert.equal((await f.request("/nope")).status, 404);
    const s = await f.snapshot();
    assert.equal(s.transcript, "user:\nhello");
    assert.equal(s.inputGranted, false);
    assert.equal(s.instanceId, f.registration.id);
    assert.equal("token" in s, false);
    if (process.platform !== "win32") {
      assert.equal(statSync(f.directory).mode & 0o777, 0o700);
      assert.equal(statSync(f.file).mode & 0o777, 0o600);
    }
    assert.equal((await f.request("/submit", { text: "x".repeat(17000) })).status, 413);
  } finally { await f.close(); }
});

test("GrantAndSubmit / RefuseUnsafeInput: confirmation, reservations, idempotency, revoke and stale generation", async () => {
  const f = await fixture();
  try {
    const { generation } = await f.snapshot();
    const input = { generation, inputId: "one", text: "plain text" };
    assert.equal((await f.request("/submit", input)).status, 403);
    f.confirm(false); await f.allow();
    assert.equal((await f.snapshot()).inputGranted, false);
    f.confirm(true); await f.allow();
    for (const text of ["/help", "  !whoami", "\n/skill:unsafe", "", "x".repeat(8001)]) {
      assert.equal((await f.request("/submit", { ...input, text })).status, 400);
    }
    f.idle(false);
    assert.equal((await f.request("/submit", input)).status, 409);
    f.idle(true);
    await f.emit("ui_prompt_start");
    assert.equal((await f.request("/submit", input)).status, 409);
    await f.emit("ui_prompt_end");
    const responses = await Promise.all([f.request("/submit", input), f.request("/submit", input)]);
    for (const response of responses) assert.deepEqual(await response.json(), { submitted: true });
    assert.deepEqual(f.sent, ["plain text"]);
    assert.equal((await f.request("/submit", { ...input, text: "different" })).status, 409);
    assert.equal((await f.request("/submit", { ...input, inputId: "two" })).status, 409);
    await f.emit("agent_end"); // Low-level end must not release the reservation.
    assert.equal((await f.request("/submit", { ...input, inputId: "two" })).status, 409);
    await f.emit("agent_settled");
    assert.equal((await f.request("/submit", { ...input, inputId: "two" })).status, 200);
    await f.emit("message_start", { message: { role: "user", content: "plain text" } });
    await f.revoke();
    assert.equal((await f.request("/submit", { ...input, inputId: "three" })).status, 403);
    f.session("session-two"); await f.emit("session_tree");
    assert.notEqual((await f.snapshot()).generation, generation);
    assert.equal(JSON.parse(readFileSync(f.file, "utf8")).sessionId, "session-two");
    assert.equal((await f.request("/submit", input)).status, 409);
  } finally { await f.close(); }
});

test("RefuseUnsafeInput: uncertain timeout never releases or resends input", async (t) => {
  const f = await fixture();
  try {
    await f.allow();
    const { generation } = await f.snapshot();
    const input = { generation, inputId: "uncertain", text: "may be intercepted" };
    assert.equal((await f.request("/submit", input)).status, 200);
    const later = Date.now() + 31_000;
    t.mock.method(Date, "now", () => later);
    assert.equal((await f.snapshot()).activity, "waiting");
    assert.equal((await f.request("/submit", { ...input, inputId: "retry-new-id" })).status, 409);
    assert.deepEqual(await (await f.request("/submit", input)).json(), { submitted: true });
    assert.deepEqual(f.sent, [input.text]);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("ObserveAndReconnect: branch transcript and streaming are bounded; shutdown releases only owned claim", async () => {
  const f = await fixture();
  try {
    f.entries(Array.from({ length: 120 }, () => ({ type: "message", message: { role: "assistant", content: "\u0000".repeat(90000) } })));
    await f.emit("message_update", { message: { role: "assistant", content: "partial reply" } });
    const response = await f.request("/snapshot");
    const bytes = await response.text();
    assert.ok(Buffer.byteLength(bytes) <= 512 * 1024);
    const snapshot = JSON.parse(bytes);
    assert.equal(snapshot.truncated, true);
    assert.match(snapshot.transcript, /partial reply/);
    await f.emit("session_shutdown");
    assert.deepEqual(readdirSync(f.directory), []);
    await assert.rejects(f.request("/snapshot"));
  } finally { await f.close(); }
});

test("PrivateBridgeBoundary: unsafe registry and symlink refused; replaced claim retained", async () => {
  const f = await fixture();
  try {
    writeFileSync(f.file, "replacement");
    await f.emit("session_shutdown");
    assert.equal(readFileSync(f.file, "utf8"), "replacement");
  } finally { await f.close(); }
  if (process.platform === "win32") return; // POSIX permissions and symlink privileges differ.
  for (const unsafe of ["permissions", "symlink"]) {
    const root = mkdtempSync(join(tmpdir(), "cli-bridge-unsafe-"));
    const directory = join(root, "registry");
    if (unsafe === "permissions") { chmodSync(root, 0o777); } else { symlinkSync(root, directory); }
    const old = process.env.PI_OUTPOST_BRIDGE_DIR;
    process.env.PI_OUTPOST_BRIDGE_DIR = directory;
    const handlers = new Map<string, Function>();
    bridge({ on: (name: string, fn: Function) => handlers.set(name, fn), registerCommand() {} } as unknown as ExtensionAPI);
    if (old === undefined) delete process.env.PI_OUTPOST_BRIDGE_DIR; else process.env.PI_OUTPOST_BRIDGE_DIR = old;
    try { await assert.rejects(handlers.get("session_start")!({}, { mode: "tui" }), /Unsafe bridge/); }
    finally { chmodSync(root, 0o700); rmSync(root, { recursive: true, force: true }); }
  }
});

test("ConfirmedTerminalHandoff / ShutdownEventIsNotRelease: separate consent prepares receipt and closes CLI without rewriting history", async () => {
  const f = await fixture();
  try {
    const sessionFile = f.persist();
    const before = readFileSync(sessionFile);
    await f.allow();
    await f.handoff();
    const receipts = readdirSync(f.handoffDirectory).filter((name) => name.endsWith(".json"));
    assert.equal(receipts.length, 1);
    const receipt = JSON.parse(readFileSync(join(f.handoffDirectory, receipts[0]), "utf8"));
    assert.equal(receipt.sessionId, f.registration.sessionId);
    assert.equal(receipt.sessionFile, sessionFile);
    assert.equal(receipt.pid, process.pid);
    assert.equal(f.shutdowns(), 1);
    assert.deepEqual(readFileSync(sessionFile), before);
    assert.deepEqual(await f.emit("input", { text: "must not start a new turn" }), { action: "handled" });
    const { claimCliHandoff } = await import("../shared/src/cliHandoffStore.ts");
    await assert.rejects(claimCliHandoff(receipt.id, f.root, f.root, f.handoffDirectory));
    await f.emit("session_shutdown");
    await assert.rejects(claimCliHandoff(receipt.id, f.root, f.root, f.handoffDirectory));
    assert.deepEqual(readFileSync(sessionFile), before);
  } finally { await f.close(); }
});

test("DeclinedOrBusyTerminalHandoff: no release while declined, working, queued or dialog-blocked", async () => {
  for (const reason of ["declined", "working", "queued", "dialog", "changed", "became-busy"]) {
    const f = await fixture();
    try {
      f.persist();
      if (reason === "declined") f.confirm(false);
      if (reason === "working") f.idle(false);
      if (reason === "queued") f.pendingMessages(true);
      if (reason === "dialog") await f.emit("ui_prompt_start");
      if (reason === "changed") f.confirmHook(() => f.session("different-session"));
      if (reason === "became-busy") f.confirmHook(() => f.idle(false));
      await f.handoff();
      assert.equal(f.shutdowns(), 0, reason);
      const { existsSync } = await import("node:fs");
      assert.equal(existsSync(f.handoffDirectory), false, reason);
    } finally { await f.close(); }
  }
});

test("CliCannotReopenReservedFile: enrolled runtime resume is cancelled before another session loads", async () => {
  const f = await fixture();
  try {
    const source = f.persist();
    await f.handoff();
    const name = readdirSync(f.handoffDirectory).find(name => name.endsWith(".json"))!;
    const file = join(f.handoffDirectory, name);
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...receipt, owner: { pid: process.pid, workspace: "web-owner" } }));
    const before = readFileSync(source);
    assert.deepEqual(await f.emit("session_before_switch", { reason: "resume", targetSessionFile: source }), { cancel: true });
    assert.deepEqual(readFileSync(source), before);
  } finally { await f.close(); }
});

test("ConfirmedTerminalHandoff: explicit close can release an SDK-idle owner without retrying an unresolved intercepted submission", async () => {
  const f = await fixture();
  try {
    f.persist(); await f.allow();
    const { generation } = await f.snapshot();
    assert.equal((await f.request("/submit", { generation, inputId: "uncertain-before-handoff", text: "may be intercepted" })).status, 200);
    await f.handoff();
    assert.equal(f.shutdowns(), 1);
    assert.deepEqual(f.sent, ["may be intercepted"]);
    assert.equal(readdirSync(f.handoffDirectory).filter(name => name.endsWith(".json")).length, 1);
  } finally { await f.close(); }
});
