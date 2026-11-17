import assert from "node:assert/strict";
import { mkdir, realpath, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { connect, makeWorkspace, startServer } from "./harness.mjs";
import { secondProject, sessionsDirOf } from "./multiProjectHarness.mjs";

// Far-future timestamps outrank any session the server itself creates while the test runs.
async function seed(sessionsDir, cwd, id, minute) {
  const directory = path.join(sessionsDir, `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
  await mkdir(directory, { recursive: true });
  const at = `2099-01-01T00:${String(minute).padStart(2, "0")}:00Z`;
  const file = path.join(directory, `${id}.jsonl`);
  await writeFile(file, [
    { type: "session", version: 3, id, cwd, timestamp: at },
    { type: "message", id: `${id}-u`, parentId: null, timestamp: at, message: { role: "user", content: [{ type: "text", text: `Question ${id}` }], timestamp: Date.parse(at) } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  // Either reader may date it: the transcript (session store) or the file (Pi CLI history).
  await utimes(file, new Date(at), new Date(at));
  return file;
}

// openlore: scenario=RecentSessionsSpanOpenProjectsWithoutStartingThem spec=multi-project-workspaces
test("recent_sessions lists the five newest across open projects without starting a stopped one", async (t) => {
  const root = await realpath(await makeWorkspace({ "a.md": "alpha\n" }));
  const beta = await secondProject();
  const sessionsDir = sessionsDirOf(root);
  const files = {};
  for (const [cwd, id, minute] of [[root, "r1", 1], [beta, "b1", 2], [root, "r2", 3], [beta, "b2", 4], [root, "r3", 5], [beta, "b3", 6], [root, "r4", 7]]) {
    files[id] = await seed(sessionsDir, cwd, id, minute);
  }
  const server = await startServer(root, { openProjects: [beta], sandbox: false, noExtensions: true });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor((m) => m.type === "hello");

  client.send({ type: "switch_session", path: files.r4 });
  await client.waitFor((m) => m.type === "session_replaced");
  client.send({ type: "recent_sessions" });
  const { sessions } = await client.waitFor((m) => m.type === "recent_sessions");

  assert.deepEqual(sessions.map((s) => s.id), ["r4", "b3", "r3", "b2", "r2"], "newest first, capped at five, across both projects");
  assert.deepEqual(sessions.map((s) => s.root), [root, beta, root, beta, root]);
  assert.equal(sessions[1].projectName, path.basename(beta));
  assert.equal(sessions[1].firstMessage, "Question b3");
  assert.equal(sessions[0].workspaceId, root, "the live conversation names the session holding it");
  assert.equal(sessions[0].activity, "idle");
  assert.equal(sessions[1].activity, undefined, "a conversation not live anywhere has no status");

  const observer = connect(server.wsUrl());
  t.after(() => observer.close());
  const hello = await observer.waitFor((m) => m.type === "hello");
  assert.equal(hello.workspaces.find((w) => w.root === beta)?.activity, "stopped", "listing did not start the stopped project");
});
