import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { SubagentManagementOperation } from "@pi-outpost/shared";
import {
  applyChanges, bodyOf, describeAgentFile, isUnsafeName, manageSubagents, scanSubagentSkills, setFrontmatterKey, skillList,
  type SubagentContext, yamlScalar,
} from "../src/subagentFiles.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "pi-outpost-subagents-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  const home = path.join(base, "home");
  await Promise.all([mkdir(root, { recursive: true }), mkdir(agentDir, { recursive: true }), mkdir(home, { recursive: true })]);
  const packages: string[] = [];
  const ctx: SubagentContext = { root, agentDir, home, packages: async () => packages, runtime: { kind: "embedded" } };
  const op = (operation: SubagentManagementOperation) => manageSubagents(ctx, operation);
  const write = async (rel: string, content: string) => { const file = path.join(base, rel); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); return file; };
  return { base, root, agentDir, home, ctx, op, write, packages };
}

describe("frontmatter key-block rewrite", () => {
  // openlore: scenario=UnknownFieldsPreserved spec=subagent-manager
  test("changing only the model leaves every other byte, comment, unknown key and CRLF in place", () => {
    const original = "---\r\nname: reviewer\r\n# reviewers keep project memory\r\nmemory: project\r\nisolation: worktree\r\nmodel: anthropic/old\r\ntools:\r\n  - read\r\n---\r\n\r\nReview code.\r\n";
    const saved = applyChanges(original, { model: "anthropic/claude-sonnet-4-6" });
    assert.equal(saved, original.replace("model: anthropic/old", "model: anthropic/claude-sonnet-4-6"));
    const before = original.split("\r\n"), after = saved.split("\r\n");
    assert.deepEqual(after.map((line, i) => (line === before[i] ? null : i)).filter((i) => i !== null), [5]);
  });

  test("a new key is appended before the closing fence and inherit removes the whole block", () => {
    const original = "---\nname: a\ntools:\n  - read\n  - bash\n---\nbody\n";
    assert.equal(setFrontmatterKey(original, "thinking", "high"), "---\nname: a\ntools:\n  - read\n  - bash\nthinking: high\n---\nbody\n");
    assert.equal(setFrontmatterKey(original, "tools", undefined), "---\nname: a\n---\nbody\n");
    assert.equal(setFrontmatterKey("plain prompt\n", "name", "x"), "---\nname: x\n---\nplain prompt\n");
  });

  // openlore: scenario=AttachTwoSkills spec=subagent-manager
  // openlore: scenario=DetachAllWritesFalse spec=subagent-manager
  // openlore: scenario=InheritRemovesKey spec=subagent-manager
  test("skills: a selection writes CSV, an empty selection writes false, all removes the key and its alias", () => {
    const original = "---\nname: writer\ndescription: Writes\n---\n\nWrite.\n";
    const two = applyChanges(original, { skills: ["pdf", "docx"] });
    assert.equal(two, "---\nname: writer\ndescription: Writes\nskills: pdf, docx\n---\n\nWrite.\n");
    assert.deepEqual(describeAgentFile(two, "writer").skills, ["pdf", "docx"]);
    assert.match(applyChanges(two, { skills: [] }), /^skills: false$/m);
    assert.equal(describeAgentFile(applyChanges(two, { skills: [] }), "writer").skills, false);
    assert.equal(applyChanges("---\nskills: pdf\n---\n", { skills: true }), "---\n---\n");
    assert.equal(applyChanges("---\ninherit_skills: pdf\nx: 1\n---\n", { skills: ["docx"] }), "---\nskills: docx\nx: 1\n---\n");
    assert.throws(() => applyChanges(original, { skills: ["../etc"] }), /Invalid skill name/);
  });

  // openlore: scenario=ToolsAllowListWritten spec=subagent-manager
  // openlore: scenario=DisableWritesEnabledFalse spec=subagent-manager
  test("tools keep extra entries verbatim; disable writes enabled: false and enabling removes it", () => {
    const original = "---\nname: a\ntools: read, mcp:github/*\n---\n";
    const tools = applyChanges(original, { tools: "read, grep, mcp:github/*" });
    assert.equal(tools, "---\nname: a\ntools: read, grep, mcp:github/*\n---\n");
    assert.equal(describeAgentFile(tools, "a").tools, "read, grep, mcp:github/*");
    const disabled = applyChanges(original, { enabled: false });
    assert.equal(disabled, "---\nname: a\ntools: read, mcp:github/*\nenabled: false\n---\n");
    assert.equal(describeAgentFile(disabled, "a").enabled, false);
    assert.equal(applyChanges(disabled, { enabled: true }), original);
    assert.equal(applyChanges(original, { tools: "" }), "---\nname: a\ntools: none\n---\n");
  });

  // openlore: scenario=PromptEditKeepsFrontmatter spec=subagent-manager
  test("a prompt edit replaces only the body and keeps the frontmatter bytes and line ending", () => {
    const original = "---\r\nname: a # inline\r\n---\r\n\r\nOld prompt.\r\n";
    const saved = applyChanges(original, { prompt: "New prompt.\nSecond line." });
    assert.equal(saved, "---\r\nname: a # inline\r\n---\r\n\r\nNew prompt.\r\nSecond line.\r\n");
    assert.equal(bodyOf(saved), "New prompt.\nSecond line.\n");
    assert.equal(applyChanges(original, { prompt: bodyOf(original) }), original);
  });

  test("scalars stay plain when pi reads them back exactly, else they are quoted", () => {
    assert.equal(yamlScalar("anthropic/claude-sonnet-4-6"), "anthropic/claude-sonnet-4-6");
    assert.equal(yamlScalar("Scout: find things"), '"Scout: find things"');
    assert.equal(yamlScalar("audit #security"), '"audit #security"');
    assert.equal(yamlScalar("true"), '"true"');
    assert.equal(describeAgentFile(`---\ndescription: ${yamlScalar("a: b #c")}\n---\n`, "x").description, "a: b #c");
    assert.throws(() => yamlScalar("two\nlines"), /one line/);
  });
});

describe("confined agent file operations", () => {
  test("names follow pi-subagents' isUnsafeName rule", () => {
    for (const bad of ["", "../x", "a/b", "a\\b", ".hidden", "-x", "x".repeat(129), "a b"]) assert.equal(isUnsafeName(bad), true, bad);
    for (const good of ["reviewer", "doc-helper", "Explore", "v1.2_x", "x".repeat(128)]) assert.equal(isUnsafeName(good), false, good);
  });

  // openlore: scenario=TraversalNameRefused spec=subagent-manager
  test("traversal names are refused and no file is created", async (t) => {
    const f = await fixture(t);
    for (const name of ["../../.ssh/authorized_keys", "a/b"]) {
      const reply = await f.op({ action: "create", scope: "project", name });
      assert.match(reply.error ?? "", /Invalid agent name/);
    }
    assert.equal(existsSync(path.join(f.base, ".ssh")), false);
    assert.equal(existsSync(path.join(f.root, ".pi", "agents", "a")), false);
    assert.match((await f.op({ action: "create", scope: "elsewhere" as "project", name: "x" })).error ?? "", /Unknown agent scope/);
  });

  // openlore: scenario=SymlinkedTargetRefused spec=subagent-manager
  test("a symlinked target file or agent directory is refused and its target is unchanged", { skip: process.platform === "win32" && "file symlinks need privileges on Windows" }, async (t) => {
    const f = await fixture(t);
    const outside = await f.write("outside.md", "---\nname: x\n---\nsecret\n");
    await mkdir(path.join(f.root, ".pi", "agents"), { recursive: true });
    await symlink(outside, path.join(f.root, ".pi", "agents", "x.md"));
    const listed = await f.op({ action: "list" });
    const entry = listed.data!.agents.find((agent) => agent.name === "x")!;
    assert.equal(entry.scope, undefined, "a symlinked file is not offered for editing");
    const { contentHash } = await import("../src/subagentFiles.ts");
    const reply = await f.op({ action: "save", scope: "project", name: "x", hash: contentHash(await readFile(outside, "utf8")), changes: { model: "m/x" } });
    assert.match(reply.error ?? "", /symlink/);
    assert.equal(await readFile(outside, "utf8"), "---\nname: x\n---\nsecret\n");

    const elsewhere = path.join(f.base, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, path.join(f.agentDir, "agents"), "dir");
    assert.match((await f.op({ action: "create", scope: "global", name: "y" })).error ?? "", /through a symlink/);
    assert.equal(existsSync(path.join(elsewhere, "y.md")), false);
  });

  // openlore: scenario=RenameKeepsNameAndFileInStep spec=subagent-manager
  // openlore: scenario=RenameOntoExistingRefused spec=subagent-manager
  test("rename moves file and name together; renaming onto an existing agent changes nothing", async (t) => {
    const f = await fixture(t);
    const created = await f.op({ action: "create", scope: "project", name: "helper" });
    assert.equal(created.error, undefined);
    const dir = path.join(f.root, ".pi", "agents");
    const before = await readFile(path.join(dir, "helper.md"), "utf8");
    const helper = created.data!.agents.find((agent) => agent.file === "helper")!;
    const renamed = await f.op({ action: "rename", scope: "project", name: "helper", to: "doc-helper", hash: helper.hash! });
    assert.equal(renamed.error, undefined);
    assert.equal(existsSync(path.join(dir, "helper.md")), false);
    assert.equal(await readFile(path.join(dir, "doc-helper.md"), "utf8"), before.replace("name: helper", "name: doc-helper"));

    await f.op({ action: "create", scope: "project", name: "a" });
    const listed = await f.op({ action: "create", scope: "project", name: "b" });
    const [a, b] = await Promise.all(["a", "b"].map((name) => readFile(path.join(dir, `${name}.md`), "utf8")));
    const refused = await f.op({ action: "rename", scope: "project", name: "a", to: "b", hash: listed.data!.agents.find((agent) => agent.file === "a")!.hash! });
    assert.match(refused.error ?? "", /already exists/);
    assert.equal(await readFile(path.join(dir, "a.md"), "utf8"), a);
    assert.equal(await readFile(path.join(dir, "b.md"), "utf8"), b);
    assert.match((await f.op({ action: "create", scope: "project", name: "a" })).error ?? "", /already exists/);
  });

  // openlore: scenario=ExternalEditConflict spec=subagent-manager
  test("a save based on stale content is a conflict and the external change is kept", async (t) => {
    const f = await fixture(t);
    const created = await f.op({ action: "create", scope: "global", name: "w" });
    const loaded = created.data!.agents.find((agent) => agent.file === "w")!;
    const file = path.join(f.agentDir, "agents", "w.md");
    await writeFile(file, "---\nname: w\ndescription: edited elsewhere\n---\n");
    const reply = await f.op({ action: "save", scope: "global", name: "w", hash: loaded.hash!, changes: { description: "mine" } });
    assert.equal(reply.conflict, true);
    assert.equal(await readFile(file, "utf8"), "---\nname: w\ndescription: edited elsewhere\n---\n");
    assert.equal(reply.data!.agents.find((agent) => agent.file === "w")!.description, "edited elsewhere");
    const deleted = await f.op({ action: "delete", scope: "global", name: "w", hash: loaded.hash! });
    assert.equal(deleted.conflict, true);
    assert.ok(existsSync(file));
  });

  // openlore: scenario=DuplicateReadOnlyIntoScope spec=subagent-manager
  test("a built-in agent duplicates into global scope with its prompt, settings and new name", async (t) => {
    const f = await fixture(t);
    const pkg = path.join(f.base, "pkg");
    await f.write("pkg/package.json", JSON.stringify({ name: "@tintinweb/pi-subagents", version: "0.25.0", type: "module" }));
    await f.write("pkg/dist/default-agents.js", `export const DEFAULT_AGENTS = new Map([["Explore", { name: "Explore", displayName: "Explore", description: "Find: code", builtinToolNames: ["read", "grep"], systemPrompt: "Search only.", promptMode: "replace" }]]);\n`);
    f.packages.push(pkg);
    const listed = await f.op({ action: "list" });
    const builtin = listed.data!.agents.find((agent) => agent.source === "builtin")!;
    assert.equal(builtin.name, "Explore");
    assert.equal(builtin.scope, undefined);
    const reply = await f.op({ action: "duplicate", from: { source: "builtin", name: "Explore" }, scope: "global", name: "my-explore" });
    assert.equal(reply.error, undefined);
    const content = await readFile(path.join(f.agentDir, "agents", "my-explore.md"), "utf8");
    const parsed = describeAgentFile(content, "my-explore");
    assert.equal(parsed.name, "my-explore");
    assert.equal(parsed.description, "Find: code");
    assert.equal(parsed.tools, "read, grep");
    assert.equal(parsed.prompt, "Search only.\n");
    assert.equal(parsed.promptMode, "replace");
    const copy = reply.data!.agents.find((agent) => agent.file === "my-explore")!;
    assert.equal(copy.source, "global");
  });
});

describe("discovery", () => {
  // openlore: scenario=ProjectOverridesGlobal spec=subagent-manager
  // openlore: scenario=ReadOnlySourcesCannotBeEdited spec=subagent-manager
  test("sources load package < global < shared < project, with override status and read-only sources", async (t) => {
    const f = await fixture(t);
    await f.write("pkg/package.json", JSON.stringify({ name: "fake-agents", pi: { subagents: { agents: ["./agents", "!./agents/wip.md"] } } }));
    await f.write("pkg/agents/reviewer.md", "---\ndescription: package reviewer\ncolor: teal\n---\n");
    await f.write("pkg/agents/wip.md", "---\ndescription: excluded\n---\n");
    f.packages.push(path.join(f.base, "pkg"));
    await f.write("agent/agents/reviewer.md", "---\ndescription: global reviewer\n---\n");
    await f.write("project/.agents/agents/shared.md", "---\ndescription: shared\n---\n");
    await f.write("project/.pi/agents/reviewer.md", "---\ndescription: project reviewer\nmemory: project\n---\n");
    await f.write("project/.pi/agents/broken.md", "---\nname: [unclosed\n---\n");
    const { agents } = (await f.op({ action: "list" })).data!;
    const by = (source: string) => agents.find((agent) => agent.name === "reviewer" && agent.source === source)!;
    assert.deepEqual([by("package").active, by("package").overriddenBy, by("package").scope, by("package").packageName], [false, "project", undefined, "fake-agents"]);
    assert.deepEqual([by("global").active, by("global").overriddenBy, by("global").scope], [false, "project", "global"]);
    assert.deepEqual([by("project").active, by("project").overrides, by("project").scope], [true, "global", "project"]);
    assert.deepEqual(by("project").otherFields, [{ key: "memory", value: "project" }]);
    assert.equal(by("package").color, "teal");
    assert.equal(agents.some((agent) => agent.description === "excluded"), false);
    const shared = agents.find((agent) => agent.name === "shared")!;
    assert.deepEqual([shared.source, shared.scope, shared.active], ["shared", undefined, true]);
    assert.match(agents.find((agent) => agent.file === "broken")!.error ?? "", /skips this file/);
  });

  // openlore: scenario=UnreachableSkillDisabled spec=subagent-manager
  test("skills follow the loader's five roots and layouts; others from the inventory are disabled with a reason", { skip: process.platform === "win32" && "directory symlink fixture" }, async (t) => {
    const f = await fixture(t);
    await f.write("agent/skills/pdf/SKILL.md", "pdf");
    await f.write("agent/skills/group/docx/SKILL.md", "docx");
    await f.write("agent/skills/group/docx/inner/SKILL.md", "skills do not nest");
    await f.write("agent/skills/flat.md", "flat");
    await f.write("agent/skills/.hidden/secret/SKILL.md", "dot");
    await f.write("agent/skills/node_modules/dep/SKILL.md", "dep");
    await f.write("project/.pi/skills/local/SKILL.md", "local");
    await f.write("home/.agents/skills/pdf/SKILL.md", "lower priority duplicate");
    await f.write("linked-target/linked/SKILL.md", "behind symlink");
    await mkdir(path.join(f.home, ".pi"), { recursive: true });
    await symlink(path.join(f.base, "linked-target"), path.join(f.home, ".pi", "skills"), "dir");
    const found = scanSubagentSkills(f.ctx);
    assert.deepEqual([...found.keys()].sort(), ["docx", "flat", "local", "pdf"]);
    assert.equal(found.get("pdf")!.path, path.join(f.agentDir, "skills", "pdf", "SKILL.md"));
    assert.equal(found.get("local")!.projectOnly, true);
    const list = skillList({ ...f.ctx, inventorySkills: () => [{ name: "linked", path: path.join(f.base, "linked-target", "linked", "SKILL.md") }, { name: "pdf" }] });
    const linked = list.find((skill) => skill.name === "linked")!;
    assert.equal(linked.available, false);
    assert.match(linked.reason!, /not available to sub-agents/i);
    assert.equal(list.find((skill) => skill.name === "pdf")!.available, true);
  });
});
