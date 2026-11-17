/**
 * The Agents panel's WebSocket operations against real isolated servers, without a model
 * request. A stand-in extension answers pi-subagents' RPC channels on the runtime's bus.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const FAKE_RPC = fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));

/** A pi extension that answers ping and spawn the way pi-subagents does, recording spawns. */
async function fakeSubagents(root) {
  const file = path.join(root, "fake-subagents.ts");
  const log = path.join(root, "spawns.jsonl");
  await fs.writeFile(file, `import { appendFileSync } from "node:fs";
export default (pi) => {
  pi.events.on("subagents:rpc:ping", (d) => pi.events.emit("subagents:rpc:ping:reply:" + d.requestId, { success: true, data: { version: 2 } }));
  pi.events.on("subagents:rpc:spawn", (d) => {
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({ type: d.type, prompt: d.prompt }) + "\\n");
    pi.events.emit("subagents:rpc:spawn:reply:" + d.requestId, d.type === "missing" ? { success: false, error: "Unknown agent type: missing" } : { success: true, data: { id: "fake-agent-1" } });
  });
};
`);
  return { file, log };
}

async function session(server) {
  const client = connect(server.wsUrl());
  await client.open();
  await client.waitFor("hello");
  let sequence = 0;
  const request = async (operation) => {
    const requestId = `agents-${++sequence}`;
    client.send({ type: "subagent_management", requestId, operation });
    return client.waitFor((message) => message.type === "subagent_management_result" && message.requestId === requestId);
  };
  return { client, request };
}

// openlore: scenario=RunSpawnsInCurrentProject spec=subagent-manager
// openlore: scenario=ExternalEditConflict spec=subagent-manager
// openlore: scenario=TraversalNameRefused spec=subagent-manager
test("list, create, save, conflict, rename, run and delete over the wire", async () => {
  const root = await fs.realpath(await makeWorkspace({ ".pi-agent/skills/alpha/SKILL.md": "---\nname: alpha\ndescription: a\n---\n" }));
  const home = path.join(root, "home");
  await fs.mkdir(home);
  const fake = await fakeSubagents(root);
  const server = await startServer(root, { sandbox: false, noExtensions: true, extensionPaths: [fake.file] }, { env: { HOME: home, USERPROFILE: home } });
  const { client, request } = await session(server);
  try {
    const listed = await request({ action: "list" });
    assert.equal(listed.error, undefined);
    assert.equal(listed.data.loaded, true);
    assert.equal(listed.data.canRun, true);
    assert.deepEqual(listed.data.agents, []);
    assert.deepEqual(listed.data.skills.map((skill) => [skill.name, skill.available]), [["alpha", true]]);
    assert.equal(listed.data.dirs.project, path.join(root, ".pi", "agents"));

    const created = await request({ action: "create", scope: "project", name: "reviewer" });
    assert.equal(created.error, undefined);
    const file = path.join(root, ".pi", "agents", "reviewer.md");
    let entry = created.data.agents.find((agent) => agent.file === "reviewer");
    assert.equal(entry.source, "project");

    const saved = await request({ action: "save", scope: "project", name: "reviewer", hash: entry.hash, changes: { skills: ["alpha"], thinking: "low" } });
    assert.equal(saved.error, undefined);
    const text = await fs.readFile(file, "utf8");
    assert.match(text, /^skills: alpha$/m);
    assert.match(text, /^thinking: low$/m);

    // The stale hash from before the save is a conflict now, and nothing is written.
    const stale = await request({ action: "save", scope: "project", name: "reviewer", hash: entry.hash, changes: { model: "x/y" } });
    assert.equal(stale.conflict, true);
    assert.equal(await fs.readFile(file, "utf8"), text);

    const traversal = await request({ action: "create", scope: "project", name: "../../escape" });
    assert.match(traversal.error, /Invalid agent name/);
    assert.equal(existsSync(path.join(root, "..", "escape.md")), false);
    const pathy = await request({ action: "save", scope: "project", name: file, hash: "", changes: {} });
    assert.match(pathy.error, /Invalid agent name/);

    entry = saved.data.agents.find((agent) => agent.file === "reviewer");
    const renamed = await request({ action: "rename", scope: "project", name: "reviewer", to: "doc-reviewer", hash: entry.hash });
    assert.equal(renamed.error, undefined);
    assert.ok(existsSync(path.join(root, ".pi", "agents", "doc-reviewer.md")));

    const run = await request({ action: "spawn", type: "doc-reviewer", prompt: "check README" });
    assert.equal(run.error, undefined);
    assert.equal(run.spawnedId, "fake-agent-1");
    assert.deepEqual((await fs.readFile(fake.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line)), [{ type: "doc-reviewer", prompt: "check README" }]);
    const refused = await request({ action: "spawn", type: "missing", prompt: "x" });
    assert.match(refused.error, /Unknown agent type: missing/);
    assert.match((await request({ action: "spawn", type: "doc-reviewer", prompt: "  " })).error, /Enter a prompt/);

    entry = renamed.data.agents.find((agent) => agent.file === "doc-reviewer");
    const deleted = await request({ action: "delete", scope: "project", name: "doc-reviewer", hash: entry.hash });
    assert.equal(deleted.error, undefined);
    assert.equal(existsSync(path.join(root, ".pi", "agents", "doc-reviewer.md")), false);
    assert.deepEqual(deleted.data.agents, []);

    assert.match((await request({ action: "chmod", scope: "project", name: "x" })).error, /Unknown agent operation/);
  } finally { client.close(); await server.stop(); }
});

// openlore: scenario=SubagentsNotLoaded spec=subagent-manager
test("without pi-subagents in the runtime the list says so and Run is refused", async () => {
  const root = await makeWorkspace();
  const home = path.join(root, "home");
  await fs.mkdir(home);
  const server = await startServer(root, { sandbox: false, noExtensions: true }, { env: { HOME: home, USERPROFILE: home } });
  const { client, request } = await session(server);
  try {
    const listed = await request({ action: "list" });
    assert.equal(listed.data.loaded, false);
    assert.equal(listed.data.canRun, false);
    assert.match(listed.data.runUnavailableReason, /pi-subagents is not loaded/);
    const run = await request({ action: "spawn", type: "x", prompt: "y" });
    assert.match(run.error, /pi-subagents is not loaded/);
  } finally { client.close(); await server.stop(); }
});

// openlore: scenario=RunUnavailableOnRpcRuntime spec=subagent-manager
test("on the rpc runtime files stay manageable and Run is unavailable with the reason", async () => {
  const root = await fs.realpath(await makeWorkspace());
  const fakeConfig = path.join(root, "fake-rpc.json");
  await fs.writeFile(fakeConfig, JSON.stringify({ stateByCwd: { [root]: { sessionId: "agents-rpc", sessionFile: path.join(root, "s.jsonl") } }, messages: [] }));
  const server = await startServer(root, { sandbox: false, agentRuntime: { mode: "rpc", executable: process.execPath, args: [FAKE_RPC], startupTimeoutMs: 5_000 } }, { env: { FAKE_PI_RPC_CONFIG: fakeConfig } });
  const { client, request } = await session(server);
  try {
    const listed = await request({ action: "list" });
    assert.equal(listed.data.loaded, undefined);
    assert.equal(listed.data.canRun, false);
    assert.match(listed.data.runUnavailableReason, /embedded agent runtime; this project uses rpc/);
    assert.match((await request({ action: "spawn", type: "x", prompt: "y" })).error, /embedded agent runtime/);
    const created = await request({ action: "create", scope: "global", name: "g" });
    assert.equal(created.error, undefined);
    assert.ok(existsSync(path.join(root, ".pi-agent", "agents", "g.md")));
  } finally { client.close(); await server.stop(); }
});
