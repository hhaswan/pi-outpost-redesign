import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSubagentActivityExtension, getSubagentActivity, subagentRpc } from "../src/subagentActivity.js";

function fixture(sessionId: string) {
  const channels = new Map<string, Set<(data: unknown) => void>>();
  const hooks = new Map<string, Set<() => void>>();
  const notifications: ReturnType<typeof getSubagentActivity>[] = [];
  function on<T>(map: Map<string, Set<T>>, name: string, handler: T) {
    const handlers = map.get(name) ?? new Set<T>();
    map.set(name, handlers);
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  }
  const pi = {
    events: { on: (name: string, handler: (data: unknown) => void) => on(channels, name, handler) },
    on: (name: string, handler: () => void) => on(hooks, name, handler),
  } as unknown as ExtensionAPI;
  const factory = createSubagentActivityExtension(sessionId, () => notifications.push(getSubagentActivity(sessionId)));
  factory(pi);
  const emit = (name: string, data: unknown) => {
    for (const handler of [...(channels.get(`subagents:${name}`) ?? [])]) handler(data);
  };
  const parent = (name: string) => {
    for (const handler of [...(hooks.get(name) ?? [])]) handler();
  };
  return {
    emit, parent, channels, hooks, notifications,
    state: () => getSubagentActivity(sessionId),
    created: (id = "child") => emit("created", { id, isBackground: true }),
    started: (id = "child") => emit("started", { id }),
    finish: (id = "child") => emit("completed", { id, status: "completed" }),
    close: () => parent("session_shutdown"),
  };
}

const empty = { running: 0, queued: 0, known: true };
const absent = { running: 0, queued: 0, known: false };

test("activation seeds empty silently; snapshots cannot mutate the ledger", () => {
  const f = fixture("empty");
  try {
    assert.deepEqual(f.state(), empty);
    assert.equal(f.notifications.length, 0);
    f.state().running = 99;
    assert.deepEqual(f.state(), empty);
  } finally { f.close(); }
  assert.deepEqual(f.state(), absent);
});

test("only explicitly detached calls count; parent end and settlement do not clear them", () => {
  const f = fixture("parent");
  try {
    f.started("foreground");
    f.emit("created", { id: "foreground", isBackground: false });
    f.emit("usage", { id: "workflow", tokens: 100 });
    assert.deepEqual(f.state(), empty);
    f.created();
    assert.deepEqual(f.state(), { running: 0, queued: 1, known: true });
    f.started();
    f.parent("agent_end");
    f.parent("agent_settled");
    assert.deepEqual(f.state(), { running: 1, queued: 0, known: true });
    f.emit("failed", { id: "child", status: "aborted" });
    assert.deepEqual(f.state(), empty);
  } finally { f.close(); }
});

test("started before created is buffered without counting foreground work", () => {
  const f = fixture("buffer");
  try {
    f.started();
    assert.deepEqual(f.state(), empty);
    assert.equal(f.notifications.length, 0);
    f.created();
    assert.deepEqual(f.state(), { running: 1, queued: 0, known: true });
    f.created();
    f.started();
    assert.equal(f.notifications.length, 1);
    f.finish();
    f.finish();
    assert.equal(f.notifications.length, 2);
  } finally { f.close(); }
});

for (const terminal of ["completed", "failed"]) {
  test(`${terminal} before created never resurrects a run`, () => {
    const f = fixture(`early-${terminal}`);
    try {
      f.started();
      f.emit(terminal, { id: "child" });
      f.created();
      assert.deepEqual(f.state(), absent);
      f.created();
      assert.equal(f.notifications.length, 1);
    } finally { f.close(); }
  });
}

test("immediate resume reuses ID but cannot claim certainty without run generations", () => {
  const f = fixture("resume");
  try {
    f.started(); f.created(); f.finish();
    f.started();
    assert.deepEqual(f.state(), absent);
    f.created();
    assert.deepEqual(f.state(), { running: 1, queued: 0, known: false });
    // An old duplicate terminal cannot be distinguished from the new run's end.
    f.finish();
    assert.deepEqual(f.state(), absent);
  } finally { f.close(); }
});

test("queued resume after terminal stays unknown rather than reporting trustworthy idle", () => {
  const f = fixture("queued-resume");
  try {
    f.created(); f.started(); f.finish();
    f.created();
    assert.deepEqual(f.state(), absent);
    f.started();
    assert.equal(f.state().known, false);
    f.finish();
    assert.deepEqual(f.state(), absent);
  } finally { f.close(); }
});

test("stale callbacks and shutdown cannot mutate a replacement activation", () => {
  const old = fixture("replacement");
  old.created();
  const staleCreated = [...old.channels.get("subagents:created")!][0]!;
  const staleDisposed = [...old.channels.get("subagents:disposed")!][0]!;
  const staleShutdown = [...old.hooks.get("session_shutdown")!][0]!;
  const fresh = fixture("replacement");
  try {
    assert.equal([...old.channels.values()].every((listeners) => listeners.size === 0), true);
    fresh.started(); fresh.created();
    staleCreated({ id: "ghost", isBackground: true });
    staleDisposed({});
    staleShutdown();
    assert.deepEqual(fresh.state(), { running: 1, queued: 0, known: true });
    assert.equal(old.notifications.length, 1);
    assert.equal(fresh.notifications.length, 1);
  } finally { fresh.close(); old.close(); }
});

test("two session buses isolate identical IDs and disposal removes only its own listeners", () => {
  const a = fixture("session-a");
  const b = fixture("session-b");
  try {
    a.started(); a.created(); b.created();
    a.emit("disposed", {});
    assert.deepEqual(a.state(), absent);
    assert.deepEqual(b.state(), { running: 0, queued: 1, known: true });
    assert.equal([...a.channels.values()].every((listeners) => listeners.size === 0), true);
    const count = a.notifications.length;
    a.created(); a.close();
    assert.equal(a.notifications.length, count);
    b.started(); b.finish();
    assert.deepEqual(b.state(), empty);
  } finally { a.close(); b.close(); }
});

for (const channel of ["started", "created", "completed", "failed", "disposed"]) {
  test(`malformed ${channel} events degrade trust without changing counts or throwing`, () => {
    const f = fixture(`malformed-${channel}`);
    try {
      f.started(); f.created();
      for (const data of [null, undefined, [], 4, "text"]) f.emit(channel, data);
      if (channel !== "disposed") {
        for (const data of [{}, { id: 4 }, { id: " " }]) f.emit(channel, data);
      }
      if (channel === "completed" || channel === "failed") {
        f.emit(channel, { id: "child", status: "running" });
        f.emit(channel, { id: "child", status: 42 });
      }
      assert.deepEqual(f.state(), { running: 1, queued: 0, known: false });
      assert.equal(f.notifications.length, 2);
    } finally { f.close(); }
  });
}

test("created requires literal true; no string coercion or status parsing", () => {
  const f = fixture("background-flag");
  try {
    f.emit("created", { id: "child", isBackground: "true", status: "running" });
    assert.deepEqual(f.state(), absent);
    f.emit("created", { id: "other" });
    assert.deepEqual(f.state(), absent);
  } finally { f.close(); }
});

test("bounded ordering history degrades trust and does not revive evicted terminal IDs", () => {
  const f = fixture("bounded-terminal");
  try {
    for (let i = 0; i < 1100; i++) f.finish(`done-${i}`);
    assert.deepEqual(f.state(), absent);
    f.created("done-0");
    assert.deepEqual(f.state(), absent);
    f.started("new"); f.created("new");
    assert.deepEqual(f.state(), { running: 1, queued: 0, known: false });
  } finally { f.close(); }
});

test("unconfirmed start buffer is bounded and never counts RPC-only starts", () => {
  const f = fixture("bounded-start");
  try {
    for (let i = 0; i < 1100; i++) f.started(`rpc-${i}`);
    assert.deepEqual(f.state(), absent);
    f.created("rpc-0");
    assert.deepEqual(f.state(), absent);
  } finally { f.close(); }
});

test("uncertain activated child ledger cannot authorize workspace retirement", async () => {
  const { Workspace, shouldRetireWorkspace } = await import("../src/workspace.js");
  const f = fixture("retirement-uncertain");
  const workspace = { _runtime: { snapshot: () => ({ sessionId: "retirement-uncertain", isStreaming: false }) } };
  const canRetire = () => shouldRetireWorkspace({ timeoutMs: 1, now: 100, lastUsedAt: 0, watched: false, readyForReview: false, busy: Workspace.prototype.isBusy.call(workspace as never) });
  try {
    assert.equal(canRetire(), true);
    f.started(); f.created(); f.finish();
    f.started(); f.created(); f.finish();
    assert.deepEqual(f.state(), { running: 0, queued: 0, known: false });
    assert.equal(canRetire(), false);
  } finally { f.close(); }
  assert.equal(canRetire(), true, "an absent ledger does not lock unrelated RPC workspaces");
});

function rpcFixture(sessionId: string, answer?: (channel: string, data: { requestId: string }, emit: (channel: string, data: unknown) => void) => void) {
  const channels = new Map<string, Set<(data: unknown) => void>>();
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const emit = (channel: string, data: unknown) => {
    emitted.push({ channel, data });
    for (const handler of [...(channels.get(channel) ?? [])]) handler(data);
    if (channel.startsWith("subagents:rpc:") && !channel.includes(":reply:")) answer?.(channel, data as { requestId: string }, emit);
  };
  const pi = {
    events: {
      on: (name: string, handler: (data: unknown) => void) => {
        const set = channels.get(name) ?? new Set();
        channels.set(name, set);
        set.add(handler);
        return () => { set.delete(handler); };
      },
      emit,
    },
    on: () => () => {},
  } as unknown as ExtensionAPI;
  createSubagentActivityExtension(sessionId, () => {})(pi);
  return { emitted, listeners: () => [...channels.entries()].filter(([name, set]) => name.includes(":reply:") && set.size > 0).length };
}

// openlore: scenario=RunSpawnsInCurrentProject spec=subagent-manager
test("spawn emits subagents:rpc:spawn on this session's bus and resolves with the reply id", async () => {
  const f = rpcFixture("rpc-reply", (channel, data, emit) => {
    queueMicrotask(() => emit(`${channel}:reply:${data.requestId}`, { success: true, data: channel.endsWith("spawn") ? { id: "agent-7" } : { version: 2 } }));
  });
  assert.deepEqual(await subagentRpc("rpc-reply", "ping", {}), { version: 2 });
  assert.deepEqual(await subagentRpc("rpc-reply", "spawn", { type: "reviewer", prompt: "check README" }), { id: "agent-7" });
  const spawn = f.emitted.find((entry) => entry.channel === "subagents:rpc:spawn")!.data as Record<string, unknown>;
  assert.equal(spawn.type, "reviewer");
  assert.equal(spawn.prompt, "check README");
  assert.equal(typeof spawn.requestId, "string");
  assert.equal(f.listeners(), 0, "reply listeners are released");
  await assert.rejects(subagentRpc("no-such-session", "ping", {}), /no extension event bus/);
});

test("an error envelope rejects with pi-subagents' message", async () => {
  rpcFixture("rpc-error", (channel, data, emit) => emit(`${channel}:reply:${data.requestId}`, { success: false, error: "Unknown agent type: nope" }));
  await assert.rejects(subagentRpc("rpc-error", "spawn", { type: "nope", prompt: "x" }), /Unknown agent type: nope/);
});

// openlore: scenario=RunTimeout spec=subagent-manager
test("a bus that never replies times out after the given period and drops its listener", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = rpcFixture("rpc-silent");
  const pending = subagentRpc("rpc-silent", "spawn", { type: "reviewer", prompt: "x" });
  t.mock.timers.tick(9_999);
  assert.equal(f.listeners(), 1);
  t.mock.timers.tick(1);
  await assert.rejects(pending, /did not answer spawn within 10 s/);
  assert.equal(f.listeners(), 0);
});
