import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { McpConfigDocument, McpConfigScope, McpManagementData, McpManagementOperation, McpManagementReply } from "@pi-outpost/shared";

const MAX_BYTES = 256 * 1024;
const MASK = "[redacted — keep existing value]";
const scopes: McpConfigScope[] = ["global", "global-adapter", "project", "project-adapter"];
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export interface McpManagementOptions {
  cwd: string;
  agentDir: string;
  /** Explicit for isolated tests; production uses the operator's home. */
  home?: string;
  editable: boolean;
  busy: () => boolean;
  gateway?: (operation: { action: "list" } | { action: "connect"; name: string }, signal: AbortSignal) => Promise<unknown>;
}

function configPath(options: McpManagementOptions, scope: McpConfigScope): string {
  switch (scope) {
    case "global": return path.join(options.home ?? homedir(), ".config", "mcp", "mcp.json");
    case "global-adapter": return path.join(options.agentDir, "mcp-adapter.json");
    case "project": return path.join(options.cwd, ".mcp.json");
    case "project-adapter": return path.join(options.cwd, ".pi", "mcp-adapter.json");
  }
}

async function readDocument(file: string): Promise<{ text: string; json: JsonObject }> {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error("MCP configuration must be a regular file smaller than 256 KiB");
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    let text: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_BYTES || info.ino !== opened.ino || info.dev !== opened.dev) throw new Error("MCP configuration changed while opening");
      text = await handle.readFile("utf8");
    } finally { await handle.close(); }
    const json: unknown = JSON.parse(text!);
    if (!object(json) || (json.mcpServers !== undefined && !object(json.mcpServers))) throw new Error("Invalid MCP configuration object");
    return { text: text!, json };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: "", json: {} };
    // Never echo file content, environment values or parser excerpts into the browser.
    throw new Error("Could not read MCP configuration; check JSON, file size, and permissions");
  }
}

/** Transport metadata is public; all other string values (including args/env/headers) are opaque. */
export function redactMcpConfig(value: unknown, key = "", depth = 0): unknown {
  if (typeof value === "string") {
    if (depth === 1 && key === "url") {
      try { const url = new URL(value); return url.username || url.password || url.search ? MASK : value; } catch { return MASK; }
    }
    return depth === 1 && ["command", "type", "transport", "exposure"].includes(key) ? value : MASK;
  }
  if (typeof value === "number") return depth === 1 && ["timeout", "requestTimeout", "connectionTimeout"].includes(key) ? value : MASK;
  if (typeof value === "boolean") return depth === 1 ? value : MASK;
  if (Array.isArray(value)) return value.map((entry) => redactMcpConfig(entry, "", depth + 1));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, redactMcpConfig(entry, name, depth + 1)]));
  return value;
}

function restoreRedacted(value: unknown, previous: unknown): unknown {
  if (value === MASK) {
    if (previous === undefined) throw new Error("Redacted fields can only retain an existing value");
    return previous;
  }
  if (Array.isArray(value)) return value.map((entry, i) => restoreRedacted(entry, Array.isArray(previous) ? previous[i] : undefined));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restoreRedacted(entry, object(previous) ? previous[key] : undefined)]));
  return value;
}

function validateConfig(config: JsonObject): void {
  const hasUrl = typeof config.url === "string" && config.url.length > 0;
  const hasCommand = typeof config.command === "string" && config.command.trim().length > 0;
  if (hasUrl === hasCommand) throw new Error("Provide exactly one HTTP URL or stdio command");
  if (hasUrl) {
    let url: URL;
    try { url = new URL(config.url as string); } catch { throw new Error("Invalid MCP URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("MCP URL must use HTTP(S), without embedded credentials");
  }
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string"))) throw new Error("MCP command args must be a string array");
  for (const key of ["env", "headers"]) {
    if (config[key] !== undefined && (!object(config[key]) || Object.values(config[key]).some((entry) => typeof entry !== "string"))) throw new Error(`MCP ${key} must map names to strings`);
  }
}

async function snapshot(options: McpManagementOptions): Promise<McpManagementData> {
  const documents: McpConfigDocument[] = [];
  for (const scope of scopes) {
    const file = configPath(options, scope);
    const doc = await readDocument(file);
    const servers = Object.fromEntries(Object.entries((doc.json.mcpServers ?? {}) as JsonObject).filter(([, value]) => object(value)).map(([name, value]) => [name, redactMcpConfig(value) as JsonObject]));
    documents.push({ scope, path: file, revision: digest(doc.text), servers });
  }
  const data: McpManagementData = { documents, servers: [], editable: options.editable };
  try {
    if (!options.gateway) throw new Error("This runtime has no MCP management gateway");
    const status = await deadline((signal) => options.gateway!({ action: "list" }, signal));
    if (!object(status) || !Array.isArray(status.servers)) throw new Error("MCP gateway did not return live server status");
    data.servers = status.servers.filter((entry) => object(entry) && typeof entry.name === "string" && typeof entry.status === "string").map((entry) => ({
      name: entry.name as string,
      status: entry.status as string,
      toolCount: typeof entry.toolCount === "number" ? entry.toolCount : 0,
      ...(typeof entry.listenState === "string" ? { listenState: entry.listenState } : {}),
    }));
  } catch (error) { data.statusError = error instanceof Error ? error.message : "Could not read MCP status"; }
  return data;
}

async function deadline<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("MCP operation timed out; refresh status to retry")); }, 30_000); });
  try { return await Promise.race([run(controller.signal), timeout]); }
  finally { clearTimeout(timer!); }
}

// Serialize writes from different browser connections; revisions reject stale editors.
const writes = new Map<string, Promise<unknown>>();
async function writeServer(options: McpManagementOptions, operation: Extract<McpManagementOperation, { action: "save" | "remove" }>): Promise<void> {
  if (!scopes.includes(operation.scope)) throw new Error("Unknown MCP configuration scope");
  const file = configPath(options, operation.scope);
  const before = writes.get(file) ?? Promise.resolve();
  const task = before.catch(() => {}).then(async () => {
    if (options.busy()) throw new Error("The session is working or changing; wait before changing MCP servers");
    if (operation.scope.startsWith("project") && !(await fs.stat(options.cwd)).isDirectory()) throw new Error("The project directory no longer exists");
    const doc = await readDocument(file);
    if (typeof operation.revision !== "string" || operation.revision !== digest(doc.text)) throw new Error("MCP configuration changed; refresh before saving");
    const servers = { ...((doc.json.mcpServers ?? {}) as JsonObject) };
    if (operation.action === "remove") {
      if (!Object.hasOwn(servers, operation.name)) throw new Error("MCP server no longer exists in this configuration");
      delete servers[operation.name];
    } else {
      if (operation.create === true && Object.hasOwn(servers, operation.name)) throw new Error("An MCP server with this name already exists in this scope; use Edit instead");
      if (!object(operation.config)) throw new Error("MCP configuration must be an object");
      const previous = servers[operation.name];
      const config = restoreRedacted(operation.config, previous) as JsonObject;
      if (object(previous) && (config.url !== previous.url || config.command !== previous.command || JSON.stringify(config.args) !== JSON.stringify(previous.args)) && JSON.stringify(operation.config).includes(MASK)) {
        throw new Error("Changing the server URL or command requires replacing or removing all masked fields; credentials cannot be transferred implicitly");
      }
      validateConfig(config);
      Object.defineProperty(servers, operation.name, { value: config, enumerable: true, configurable: true, writable: true });
    }
    const next = JSON.stringify({ ...doc.json, mcpServers: servers }, null, 2) + "\n";
    if (Buffer.byteLength(next) > MAX_BYTES) throw new Error("MCP configuration exceeds 256 KiB");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const parent = await fs.realpath(path.dirname(file));
    if (path.resolve(parent) !== path.resolve(path.dirname(file))) throw new Error("Refusing to write MCP configuration through a symlink");
    const temp = path.join(parent, `.mcp-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, next, { mode: 0o600, flag: "wx" });
      if (digest((await readDocument(file)).text) !== operation.revision) throw new Error("MCP configuration changed; refresh before saving");
      if (options.busy()) throw new Error("The session is working or changing; wait before changing MCP servers");
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
  });
  writes.set(file, task);
  try { await task; } finally { if (writes.get(file) === task) writes.delete(file); }
}

export async function manageMcp(options: McpManagementOptions, operation: McpManagementOperation): Promise<Omit<McpManagementReply, "requestId">> {
  if (!object(operation) || !["list", "connect", "save", "remove"].includes(operation.action)) throw new Error("Unknown MCP management operation");
  if (operation.action === "list") return { data: await snapshot(options) };
  if (!options.editable) throw new Error("MCP changes are locked by this server's sandbox or extension policy");
  if (options.busy()) throw new Error("The session is working or changing; wait before changing MCP servers");
  if (typeof operation.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(operation.name)) throw new Error("Invalid MCP server name");
  if (operation.action === "connect") {
    if (!options.gateway) throw new Error("This runtime has no MCP management gateway");
    await deadline((signal) => options.gateway!({ action: "connect", name: operation.name }, signal));
    return { data: await snapshot(options), message: "Connection attempt finished; see live status" };
  }
  await writeServer(options, operation);
  return { data: await snapshot(options), reloadRequired: true, message: "Configuration saved. Apply it by restarting this idle session; the systemd service does not need a restart." };
}
