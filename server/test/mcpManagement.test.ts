import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { manageMcp, redactMcpConfig, type McpManagementOptions } from "../src/mcpManagement.ts";

async function fixture(run: (options: McpManagementOptions) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "outpost-mcp-manager-"));
  const options: McpManagementOptions = { cwd: path.join(dir, "project"), agentDir: path.join(dir, "agent"), home: path.join(dir, "home"), editable: true, busy: () => false,
    gateway: async (operation) => operation.action === "list" ? { servers: [{ name: "live", status: "connected", toolCount: 3, listenState: "listening" }] } : { mode: "connect" } };
  await mkdir(options.cwd, { recursive: true });
  try { await run(options); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("MCP status comes from the current runtime; no fake servers are invented", async () => fixture(async (options) => {
  const result = await manageMcp(options, { action: "list" });
  assert.deepEqual(result.data?.servers, [{ name: "live", status: "connected", toolCount: 3, listenState: "listening" }]);
  const missing = await manageMcp({ ...options, gateway: undefined }, { action: "list" });
  assert.deepEqual(missing.data?.servers, []);
  assert.match(missing.data?.statusError ?? "", /no MCP management gateway/);
}));

test("MCP add edit remove persists config without exposing or losing credentials", async () => fixture(async (options) => {
  const file = path.join(options.cwd, ".mcp.json");
  await writeFile(file, JSON.stringify({ settings: { kept: true }, mcpServers: { existing: { url: "https://host/mcp", headers: { Authorization: "secret-123" }, env: { API_KEY: "secret-456" }, args: ["secret-789"] } } }));
  const initial = await manageMcp(options, { action: "list" });
  const doc = initial.data!.documents.find((entry) => entry.scope === "project")!;
  assert.ok(!JSON.stringify(initial).includes("secret-"));
  await assert.rejects(manageMcp(options, { action: "save", scope: "project", name: "existing", revision: doc.revision, config: { ...doc.servers.existing, url: "https://other-host/mcp" } }), /credentials cannot be transferred/);
  const config = { ...doc.servers.existing, exposure: "direct" };
  const edited = await manageMcp(options, { action: "save", scope: "project", name: "existing", revision: doc.revision, config });
  assert.equal(edited.reloadRequired, true);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.mcpServers.existing.headers.Authorization, "secret-123");
  assert.equal(saved.mcpServers.existing.env.API_KEY, "secret-456");
  assert.equal(saved.settings.kept, true);
  const next = edited.data!.documents.find((entry) => entry.scope === "project")!;
  const added = await manageMcp(options, { action: "save", scope: "project", name: "new", revision: next.revision, config: { command: "node", args: ["server.mjs"] } });
  const finalDoc = added.data!.documents.find((entry) => entry.scope === "project")!;
  await manageMcp(options, { action: "remove", scope: "project", name: "new", revision: finalDoc.revision });
  assert.equal(JSON.parse(await readFile(file, "utf8")).mcpServers.new, undefined);
  assert.ok(JSON.parse(await readFile(file, "utf8")).mcpServers.existing);
}));

test("MCP rejects busy, locked, malformed, stale and path-traversal requests", async () => fixture(async (options) => {
  const listed = await manageMcp(options, { action: "list" });
  const revision = listed.data!.documents.find((entry) => entry.scope === "project")!.revision;
  const save = { action: "save" as const, scope: "project" as const, name: "server", revision, config: { url: "https://host/mcp" } };
  await assert.rejects(manageMcp({ ...options, busy: () => true }, save), /session is working/);
  await assert.rejects(manageMcp({ ...options, editable: false }, save), /locked/);
  await assert.rejects(manageMcp(options, { ...save, name: "../escape" }), /Invalid MCP server name/);
  await assert.rejects(manageMcp(options, { ...save, config: { url: "file:///etc/passwd" } }), /HTTP/);
  await assert.rejects(manageMcp(options, { ...save, config: { url: "https://host", command: "bash" } }), /exactly one/);
  await assert.rejects(manageMcp(options, { ...save, scope: "../escape" as never }), /Unknown MCP configuration scope/);
  await manageMcp(options, save);
  await assert.rejects(manageMcp(options, save), /changed; refresh/);
}));

test("MCP redacts URL credentials and opaque arguments", () => {
  const rendered = JSON.stringify(redactMcpConfig({ url: "https://host/mcp?token=secret-url", args: ["secret-arg"], headers: { Authorization: "secret-header" }, auth: { token: "secret-auth" } }));
  assert.ok(!rendered.includes("secret-"));
});

test("MCP refuses invalid JSON without echoing its contents", async () => fixture(async (options) => {
  await writeFile(path.join(options.cwd, ".mcp.json"), "{ secret-password");
  await assert.rejects(manageMcp(options, { action: "list" }), (error: Error) => !error.message.includes("secret-password") && /Could not read/.test(error.message));
}));

test("MCP refuses a symlink configuration", { skip: process.platform === "win32" }, async () => fixture(async (options) => {
  const target = path.join(options.cwd, "other.json");
  await writeFile(target, "{}");
  await symlink(target, path.join(options.cwd, ".mcp.json"));
  await assert.rejects(manageMcp(options, { action: "list" }), /Could not read/);
  assert.equal(await readFile(target, "utf8"), "{}");
}));

test("MCP public transport field names do not expose nested credentials", () => {
  const shown = redactMcpConfig({ command: "node", type: "stdio", env: { command: "secret-command", type: "secret-type", url: "https://secret-host" }, headers: { exposure: "secret-header" }, auth: { numericToken: 123456789 } });
  assert.equal((shown as Record<string, unknown>).command, "node");
  assert.ok(!JSON.stringify(shown).includes("secret-"));
  assert.ok(!JSON.stringify(shown).includes("123456789"));
});

test("MCP rechecks busy state after queued work begins", async () => fixture(async (options) => {
  const list = await manageMcp(options, { action: "list" });
  let busy = false;
  const write = manageMcp({ ...options, busy: () => busy }, { action: "save", scope: "project", name: "server", revision: list.data!.documents.find((doc) => doc.scope === "project")!.revision, config: { url: "https://host/mcp" } });
  busy = true;
  await assert.rejects(write, /session is working/);
  await assert.rejects(readFile(path.join(options.cwd, ".mcp.json")));
}));

test("MCP create mode refuses a duplicate without replacing its definition", async () => fixture(async (options) => {
  const initial = await manageMcp(options, { action: "list" });
  const first = await manageMcp(options, { action: "save", scope: "project", name: "existing", create: true, revision: initial.data!.documents.find((doc) => doc.scope === "project")!.revision, config: { url: "https://original/mcp" } });
  await assert.rejects(manageMcp(options, { action: "save", scope: "project", name: "existing", create: true, revision: first.data!.documents.find((doc) => doc.scope === "project")!.revision, config: { url: "https://replacement/mcp" } }), /already exists/);
  assert.equal(JSON.parse(await readFile(path.join(options.cwd, ".mcp.json"), "utf8")).mcpServers.existing.url, "https://original/mcp");
}));

test("MCP rejects oversized configuration without writing it", async () => fixture(async (options) => {
  const listed = await manageMcp(options, { action: "list" });
  const revision = listed.data!.documents.find((doc) => doc.scope === "project")!.revision;
  await assert.rejects(manageMcp(options, { action: "save", scope: "project", name: "large", revision, config: { command: "node", args: ["x".repeat(256 * 1024)] } }), /exceeds 256 KiB/);
  await assert.rejects(readFile(path.join(options.cwd, ".mcp.json")));
  await writeFile(path.join(options.cwd, ".mcp.json"), " ".repeat(256 * 1024 + 1));
  await assert.rejects(manageMcp(options, { action: "list" }), /Could not read MCP configuration/);
}));
