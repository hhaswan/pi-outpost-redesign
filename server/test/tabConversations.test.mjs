/**
 * Independent tab conversations: two tabs on the same project share its conversation
 * until one of them changes conversation. That change moves only the asking tab onto
 * its own side session; the other tab keeps its conversation, untouched.
 */
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { next, seedSession, sessionsDirOf, wait } from "./multiProjectHarness.mjs";

async function project(t, config = {}) {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const server = await startServer(root, config);
  t.after(() => server.stop());
  const saved = seedSession(root, sessionsDirOf(root), [["user", "saved question"], ["assistant", "saved answer"]]);
  return { root, server, saved };
}

async function tab(t, server) {
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  const hello = await client.waitFor((m) => m.type === "hello", 30_000);
  return { client, hello };
}

const replacedFor = (client) => client.received.filter((m) => m.type === "session_replaced");

test("a new conversation in one tab leaves the other tab's conversation alone", async (t) => {
  // NewConversationInOneTabStaysInThatTab
  const { root, server } = await project(t);
  const { client: a, hello: helloA } = await tab(t, server);
  const { client: b, hello: helloB } = await tab(t, server);
  assert.equal(helloA.sessionId, helloB.sessionId, "both tabs start on the same conversation");

  b.send({ type: "new_session" });
  const switched = await b.waitFor((m) => m.type === "workspace_switched" || m.type === "workspace_error", 30_000);
  assert.equal(switched.type, "workspace_switched", switched.message);
  assert.equal(switched.workspace.root, root, "the asking tab stays on the project");
  assert.notEqual(switched.workspace.id, root, "on its own side session");
  assert.notEqual(switched.sessionId, helloA.sessionId, "with a new conversation");
  assert.equal(switched.items.length, 0);

  await wait(300);
  assert.equal(replacedFor(a).length, 0, "the other tab received no session_replaced");
  assert.ok(!a.received.some((m) => m.type === "workspace_switched"), "and was not moved");
  // Both sessions are listed: the other tab's is still the project's main one.
  const activity = await a.waitFor((m) => m.type === "workspace_activity" && m.workspaces.some((w) => w.id === switched.workspace.id), 30_000);
  assert.ok(activity.workspaces.some((w) => w.id === root));
});

test("switching conversation in one tab leaves the other tab's conversation alone", async (t) => {
  // SwitchingConversationInOneTabStaysInThatTab
  const { root, server, saved } = await project(t);
  const { client: a, hello: helloA } = await tab(t, server);
  const { client: b } = await tab(t, server);

  b.send({ type: "switch_session", path: saved });
  const switched = await b.waitFor((m) => m.type === "workspace_switched" || m.type === "error", 30_000);
  assert.equal(switched.type, "workspace_switched", switched.message);
  assert.notEqual(switched.workspace.id, root, "the asking tab moved onto a side session");
  assert.ok(JSON.stringify(switched.items).includes("saved question"), "showing the saved conversation");

  await wait(300);
  assert.equal(replacedFor(a).length, 0, "the other tab received no session_replaced");

  // The other tab can no longer open that file: one runtime per conversation file.
  a.send({ type: "switch_session", path: saved });
  const refused = await a.waitFor((m) => m.type === "error" && /open in/.test(m.message), 30_000);
  assert.ok(refused);
  assert.equal(replacedFor(a).length, 0);
  assert.ok(helloA.sessionId);
});

test("a tab alone on a project changes conversation in place", async (t) => {
  // ALoneTabChangesConversationInPlace
  const { root, server, saved } = await project(t);
  const { client: a, hello } = await tab(t, server);

  a.send({ type: "new_session" });
  const replaced = await a.waitFor((m) => m.type === "session_replaced", 30_000);
  assert.equal(replaced.workspace.id ?? replaced.workspace.root, root, "still the project's main session");
  assert.notEqual(replaced.sessionId, hello.sessionId);

  a.send({ type: "switch_session", path: saved });
  const switchedInPlace = await next(a, (m) => m.type === "session_replaced");
  assert.ok(JSON.stringify(switchedInPlace.items).includes("saved question"));
  assert.ok(!a.received.some((m) => m.type === "workspace_switched"), "no side session was created");
  const sides = a.received.filter((m) => m.type === "workspace_activity").flatMap((m) => m.workspaces).filter((w) => w.sideOf);
  assert.equal(sides.length, 0);
});

test("under a workspace lock the change stays shared, and the asking tab is told", async (t) => {
  // LockedServerKeepsConversationShared
  const { root, server } = await project(t, { workspaceLock: true });
  const { client: a } = await tab(t, server);
  const { client: b } = await tab(t, server);
  b.send({ type: "new_session" });
  const notice = await b.waitFor((m) => m.type === "extension_ui_request" && /pinned to one project/.test(m.message ?? ""), 30_000);
  assert.ok(notice);
  const replacedA = await a.waitFor((m) => m.type === "session_replaced", 30_000);
  assert.equal(replacedA.workspace.root, root);
});

test("a tab's own side session lives while the tab watches it, and closes once idle and unwatched", async (t) => {
  // ASplitSideSessionLivesWhileWatched
  const { server } = await project(t, { workspaceIdleTimeoutMs: 2_000 });
  const { client: a } = await tab(t, server);
  const { client: b } = await tab(t, server);
  b.send({ type: "new_session" });
  const switched = await b.waitFor((m) => m.type === "workspace_switched", 30_000);
  const sideId = switched.workspace.id;

  await wait(5_000);
  const lastActivity = a.received.filter((m) => m.type === "workspace_activity").at(-1);
  assert.ok(lastActivity.workspaces.some((w) => w.id === sideId), "still open while its tab watches it");

  const seen = a.received.length;
  b.close();
  const gone = await a.waitFor((m) => a.received.indexOf(m) >= seen && m.type === "workspace_activity" && !m.workspaces.some((w) => w.id === sideId), 15_000);
  assert.ok(gone, "closed once nobody watches it");
});
