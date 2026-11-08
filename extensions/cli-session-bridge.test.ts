import { test } from "node:test";
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
  process.env.PI_OUTPOST_BRIDGE_DIR = directory;
  const handlers = new Map<string, Function>();
  let command: Function;
  let idle = true;
  let confirm = true;
  let sessionId = "session-one";
  const sent: string[] = [];
  let entries: unknown[] = [{ type: "message", message: { role: "user", content: "hello" } }];
  const context = {
    mode: "tui", cwd: root, isIdle: () => idle, hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => join(root, `${sessionId}.jsonl`), getBranch: () => entries },
    ui: { notify() {}, confirm: async () => confirm },
  };
  bridge({ on: (name: string, fn: Function) => handlers.set(name, fn), registerCommand: (_: string, options: { handler: Function }) => { command = options.handler; }, sendUserMessage: (text: string) => { sent.push(text); } } as unknown as ExtensionAPI);
  if (old === undefined) delete process.env.PI_OUTPOST_BRIDGE_DIR; else process.env.PI_OUTPOST_BRIDGE_DIR = old;
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
  return { root, directory, file, registration, sent, emit, request, snapshot,
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
