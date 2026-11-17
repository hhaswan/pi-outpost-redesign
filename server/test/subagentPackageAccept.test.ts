/**
 * The installed pi-subagents reads what the Agents panel writes. Skipped where the package
 * is not installed (CI); the deploy script runs it on the host that has it.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { manageSubagents, type SubagentContext } from "../src/subagentFiles.ts";
import { installedSubagents, subagentsInstalled } from "./subagentPackage.mjs";

test("the installed pi-subagents loads panel-written agents with the fields the panel shows", { skip: !subagentsInstalled() && "pi-subagents is not installed here" }, async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-subagents-pkg-")));
  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(base, { recursive: true, force: true });
  });
  const root = path.join(base, "project"), agentDir = path.join(base, "agent");
  for (const skill of ["alpha", "beta", "gamma"]) {
    await mkdir(path.join(agentDir, "skills", skill), { recursive: true });
    await writeFile(path.join(agentDir, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: ${skill}\n---\n${skill} body\n`);
  }
  await mkdir(root, { recursive: true });
  const ctx: SubagentContext = { root, agentDir, home: path.join(base, "home"), packages: async () => [], runtime: { kind: "embedded" } };
  const pkg = (await installedSubagents(agentDir))!;

  let reply = await manageSubagents(ctx, { action: "create", scope: "global", name: "writer" });
  let entry = reply.data!.agents.find((agent) => agent.file === "writer")!;
  reply = await manageSubagents(ctx, { action: "save", scope: "global", name: "writer", hash: entry.hash!, changes: {
    description: "Writes: docs #1", skills: ["alpha", "beta"], tools: "read, grep, mcp__github, ext:pi-mcp/*", model: "anthropic/claude-sonnet-4-6",
    thinking: "high", promptMode: "append", enabled: false, prompt: "Write clearly.\nCite files.",
  } });
  assert.equal(reply.error, undefined);
  let loaded = pkg.load(root).get("writer");
  assert.ok(loaded, "the package registers the agent");
  assert.equal(loaded.source, "global");
  assert.equal(loaded.description, "Writes: docs #1");
  assert.deepEqual(loaded.skills, ["alpha", "beta"]);
  assert.deepEqual(loaded.builtinToolNames, ["read", "grep"]);
  assert.deepEqual(loaded.mcpToolPatterns, ["mcp__github__*"]);
  assert.deepEqual(loaded.extSelectors, ["ext:pi-mcp/*"]);
  assert.equal(loaded.model, "anthropic/claude-sonnet-4-6");
  assert.equal(loaded.thinking, "high");
  assert.equal(loaded.promptMode, "append");
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.systemPrompt, "Write clearly.\nCite files.");
  // The skills the panel offers are the ones the package's loader resolves.
  for (const skill of pkg.preloadSkills(["alpha", "beta"], root)) assert.match(skill.content, new RegExp(`${skill.name} body`));

  entry = reply.data!.agents.find((agent) => agent.file === "writer")!;
  reply = await manageSubagents(ctx, { action: "save", scope: "global", name: "writer", hash: entry.hash!, changes: { skills: [], enabled: true } });
  loaded = pkg.load(root).get("writer");
  assert.equal(loaded.skills, false);
  assert.equal(loaded.enabled, true);

  // A project file with unknown keys and CRLF still loads after an edit, and overrides global.
  await mkdir(path.join(root, ".pi", "agents"), { recursive: true });
  await writeFile(path.join(root, ".pi", "agents", "writer.md"), "---\r\nname: writer\r\n# kept\r\nmemory: project\r\nisolation: worktree\r\n---\r\n\r\nProject prompt.\r\n");
  const project = (await manageSubagents(ctx, { action: "list" })).data!.agents.find((agent) => agent.source === "project")!;
  await manageSubagents(ctx, { action: "save", scope: "project", name: "writer", hash: project.hash!, changes: { model: "openai/gpt-5" } });
  loaded = pkg.load(root).get("writer");
  assert.equal(loaded.source, "project");
  assert.equal(loaded.memory, "project");
  assert.equal(loaded.isolation, "worktree");
  assert.equal(loaded.model, "openai/gpt-5");
  assert.equal(loaded.skills, true);
});
