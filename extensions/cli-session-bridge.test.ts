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
  let sessionId = "session-one";
  const sent: string[] = [];
  const options: unknown[] = [];
  const notices: string[] = [];
  let aborts = 0;
  let entries: unknown[] = [{ type: "message", message: { role: "user", content: "hello" } }];
  const context = {
    mode: "tui", cwd: root, isIdle: () => idle, hasPendingMessages: () => false, abort: () => { aborts++; },
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => join(root, `${sessionId}.jsonl`), getBranch: () => entries },
    ui: { notify: (text: string) => { notices.push(text); }, confirm: async () => { throw new Error("no terminal confirmation is asked"); } },
  };
  bridge({ on: (name: string, fn: Function) => handlers.set(name, fn), registerCommand: (_: string, options: { handler: Function }) => { command = options.handler; }, sendUserMessage: (text: string, option: unknown) => { sent.push(text); options.push(option); } } as unknown as ExtensionAPI);
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
  return { root, directory, file, registration, sent, options, notices, emit, request, snapshot, aborts: () => aborts,
    allow: () => command!("allow", context), revoke: () => command!("revoke", context),
    idle: (value: boolean) => { idle = value; },
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
    assert.equal(s.inputGranted, true);
    assert.equal(s.instanceId, f.registration.id);
    assert.equal("token" in s, false);
    if (process.platform !== "win32") {
      assert.equal(statSync(f.directory).mode & 0o777, 0o700);
      assert.equal(statSync(f.file).mode & 0o777, 0o600);
    }
    assert.equal((await f.request("/submit", { text: "x".repeat(17000) })).status, 413);
  } finally { await f.close(); }
});

// openlore: scenario=WebInputGrantedByDefault spec=shared-cli-web-sessions
test("GrantAndSubmit / WebInputGrantedByDefault: granted at start, one notice, revoke per CLI, no terminal confirmation", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.notices, ["Outpost web can send messages to this CLI. /outpost-bridge revoke to stop."]);
    const { generation, inputGranted } = await f.snapshot();
    assert.equal(inputGranted, true);
    const input = { generation, inputId: "one", text: "plain text" };
    for (const text of ["/help", "  !whoami", "\n/skill:unsafe", "", "x".repeat(8001)]) {
      assert.equal((await f.request("/submit", { ...input, text })).status, 400);
    }
    await f.emit("ui_prompt_start");
    assert.equal((await f.request("/submit", input)).status, 409, "a terminal dialog keeps web input out");
    await f.emit("ui_prompt_end");
    const responses = await Promise.all([f.request("/submit", input), f.request("/submit", input)]);
    for (const response of responses) assert.deepEqual(await response.json(), { submitted: true });
    assert.deepEqual(f.sent, ["plain text"]);
    assert.deepEqual(f.options, [{ deliverAs: "followUp", expandPromptTemplates: false }]);
    assert.equal((await f.request("/submit", { ...input, text: "different" })).status, 409);
    assert.equal((await f.request("/submit", { ...input, inputId: "two" })).status, 409, "an idle submission not yet started reserves the input");
    await f.emit("agent_end"); // Low-level end must not release the reservation.
    assert.equal((await f.request("/submit", { ...input, inputId: "two" })).status, 409);
    await f.emit("agent_settled");
    assert.equal((await f.request("/submit", { ...input, inputId: "two" })).status, 200);
    await f.emit("message_start", { message: { role: "user", content: "plain text" } });
    await f.revoke();
    assert.equal((await f.snapshot()).inputGranted, false);
    assert.equal((await f.request("/submit", { ...input, inputId: "three" })).status, 403);
    f.session("session-two"); await f.emit("session_tree");
    assert.notEqual((await f.snapshot()).generation, generation);
    assert.equal(JSON.parse(readFileSync(f.file, "utf8")).sessionId, "session-two");
    assert.equal((await f.snapshot()).inputGranted, false, "revoke holds for this CLI across conversations");
    assert.equal((await f.request("/submit", input)).status, 409);
    await f.allow();
    const fresh = (await f.snapshot()).generation;
    assert.equal((await f.request("/submit", { generation: fresh, inputId: "four", text: "back on" })).status, 200);
  } finally { await f.close(); }
});

// openlore: scenario=BusyCliQueuesWebPromptAsFollowUp spec=shared-cli-web-sessions
test("BusyCliQueuesWebPromptAsFollowUp: a working CLI takes web text as a follow-up", async () => {
  const f = await fixture();
  try {
    const { generation } = await f.snapshot();
    f.idle(false);
    assert.equal((await f.snapshot()).activity, "working");
    assert.equal((await f.request("/submit", { generation, inputId: "a", text: "while busy" })).status, 200);
    assert.equal((await f.request("/submit", { generation, inputId: "b", text: "and again" })).status, 200, "a busy submission reserves nothing");
    assert.deepEqual(f.sent, ["while busy", "and again"]);
    assert.deepEqual(f.options, [{ deliverAs: "followUp", expandPromptTemplates: false }, { deliverAs: "followUp", expandPromptTemplates: false }]);
  } finally { await f.close(); }
});

// openlore: scenario=WebStopAbortsCliTurn spec=shared-cli-web-sessions
test("WebStopAbortsCliTurn: /abort stops the CLI turn; revoked or unauthenticated does not", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/abort", {}, "wrong")).status, 401);
    assert.equal(f.aborts(), 0);
    assert.deepEqual(await (await f.request("/abort", {})).json(), { aborted: true });
    assert.equal(f.aborts(), 1);
    await f.revoke();
    assert.equal((await f.request("/abort", {})).status, 403);
    assert.equal(f.aborts(), 1);
  } finally { await f.close(); }
});

// openlore: scenario=CliTurnStreamsToWeb spec=shared-cli-web-sessions
test("CliTurnStreamsToWeb: the events stream carries the turn as NDJSON, bounded", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${f.registration.port}/events`, { headers: { Authorization: `Bearer ${f.registration.token}` }, signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    let text = "";
    const until = async (count: number) => {
      while (text.split("\n").filter(Boolean).length < count) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    };
    await f.emit("agent_start");
    await f.emit("message_start", { message: { role: "assistant", content: [] } });
    await f.emit("message_update", { message: { role: "assistant", content: "hi" }, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" } });
    await f.emit("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "ls" } });
    await f.emit("tool_execution_start", { toolCallId: "nested", toolName: "bash", args: {}, parentToolCallId: "t1" });
    await f.emit("tool_execution_end", { toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "x".repeat(300 * 1024) }] }, isError: false });
    await f.emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });
    await f.emit("agent_end");
    const events = await until(7);
    assert.deepEqual(events.map((e) => e.type), ["agent_start", "assistant_start", "block_delta", "tool_start", "tool_end", "assistant_end", "agent_end"]);
    assert.deepEqual(events[2], { type: "block_delta", block: "text", contentIndex: 0, delta: "hi" });
    assert.equal(events[3].toolCallId, "t1", "nested calls are not streamed");
    assert.match(JSON.stringify(events[4].content), /shown when the turn ends/, "oversized output is replaced, not streamed");
    assert.equal(text.includes(f.registration.token), false);
    controller.abort();
    const unauthorized = await fetch(`http://127.0.0.1:${f.registration.port}/events`, { headers: { Authorization: "Bearer wrong" } });
    assert.equal(unauthorized.status, 401);
  } finally { await f.close(); }
});

test("RefuseUnsafeInput: uncertain timeout never releases or resends input", async (t) => {
  const f = await fixture();
  try {
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
