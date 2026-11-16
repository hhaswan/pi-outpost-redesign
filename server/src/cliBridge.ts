import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import type { CliBridgeEvent, CliBridgeOperation, CliBridgeRegistration, CliBridgeReply, CliBridgeSnapshot } from "../../shared/src/cliBridge.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REGISTRY = 256;
const MAX_FILE = 16 * 1024;
const MAX_SNAPSHOT = 512 * 1024;
const TIMEOUT = 1500;
const invalid = () => new Error("CLI bridge data is invalid or unsafe");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\0");
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const directoryPath = (directory?: string) => path.resolve(directory ?? process.env.PI_OUTPOST_BRIDGE_DIR ?? path.join(homedir(), ".pi", "outpost-bridges"));

function privateStat(stat: Stats, directory: boolean): void {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw invalid();
  if (process.platform !== "win32" && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) throw invalid();
}

async function safeDirectory(directory: string): Promise<boolean> {
  // Reject symlink ancestors too: a private final directory alone is not enough.
  const segments = directory.slice(path.parse(directory).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(directory).root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: Stats;
    try { stat = await lstat(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw invalid();
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalid();
    if (current === directory) privateStat(stat, true);
  }
  // Also handles an explicitly configured filesystem root.
  privateStat(await lstat(directory), true);
  return true;
}

function registration(value: unknown, id: string): CliBridgeRegistration {
  if (!object(value) || !keys(value, ["version", "id", "port", "token", "cwd", "sessionId", "sessionFile"]) ||
      value.version !== 1 || value.id !== id || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 ||
      !string(value.token, 512) || !/^[A-Za-z0-9_-]{32,512}$/.test(value.token) ||
      !string(value.cwd) || !path.isAbsolute(value.cwd) || !string(value.sessionId, 256) ||
      (value.sessionFile !== undefined && (!string(value.sessionFile) || !path.isAbsolute(value.sessionFile)))) throw invalid();
  return value as unknown as CliBridgeRegistration;
}

async function readRegistration(directory: string, id: string): Promise<CliBridgeRegistration> {
  if (!UUID.test(id) || !(await safeDirectory(directory))) throw invalid();
  const file = path.join(directory, `${id}.json`);
  const before = await lstat(file);
  privateStat(before, false);
  if (before.size > MAX_FILE) throw invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    privateStat(stat, false);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > MAX_FILE) throw invalid();
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE) throw invalid();
    return registration(JSON.parse(buffer.subarray(0, length).toString("utf8")), id);
  } finally { await handle.close(); }
}

async function registry(directory: string): Promise<CliBridgeRegistration[]> {
  if (!(await safeDirectory(directory))) return [];
  const result: CliBridgeRegistration[] = [];
  const dir = await opendir(directory);
  let scanned = 0;
  for await (const entry of dir) {
    if (++scanned > MAX_REGISTRY * 2) throw invalid();
    // The owner atomically publishes through private temporary files.
    if (/^\.[0-9a-f-]{36}-[0-9a-f-]{36}\.tmp$/i.test(entry.name)) continue;
    if (result.length >= MAX_REGISTRY || !entry.name.endsWith(".json") || !UUID.test(entry.name.slice(0, -5))) throw invalid();
    result.push(await readRegistration(directory, entry.name.slice(0, -5)));
  }
  return result;
}

function exchange(owner: CliBridgeRegistration, body?: string): Promise<unknown> {
  if (body !== undefined && Buffer.byteLength(body) > MAX_FILE) return Promise.reject(invalid());
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: owner.port, path: body === undefined ? "/snapshot" : "/submit",
      method: body === undefined ? "GET" : "POST", agent: false,
      headers: { authorization: `Bearer ${owner.token}`, ...(body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }) },
    }, response => {
      const limit = body === undefined ? MAX_SNAPSHOT : MAX_FILE;
      let size = 0;
      const chunks: Buffer[] = [];
      if (response.statusCode !== 200) { finish(invalid()); response.destroy(); req.destroy(); return; }
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { finish(invalid()); response.destroy(); req.destroy(); return; }
        chunks.push(chunk);
      });
      response.on("error", () => finish(invalid()));
      response.on("end", () => {
        try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { finish(invalid()); }
      });
    });
    const timer = setTimeout(() => { finish(new Error("CLI bridge owner is unreachable")); req.destroy(); }, TIMEOUT);
    function finish(error?: Error, value?: unknown) {
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    req.on("error", () => finish(new Error("CLI bridge owner is unreachable or returned invalid data")));
    req.end(body);
  });
}

function snapshot(value: unknown, owner: CliBridgeRegistration): CliBridgeSnapshot {
  if (!object(value) || !keys(value, ["instanceId", "generation", "cwd", "sessionId", "sessionFile", "activity", "inputGranted", "transcript", "truncated"]) ||
      value.instanceId !== owner.id || !string(value.generation, 256) || value.cwd !== owner.cwd || value.sessionId !== owner.sessionId || value.sessionFile !== owner.sessionFile ||
      !["idle", "waiting", "working"].includes(String(value.activity)) || typeof value.inputGranted !== "boolean" ||
      typeof value.transcript !== "string" || typeof value.truncated !== "boolean") throw invalid();
  return value as unknown as CliBridgeSnapshot;
}

async function current(owner: CliBridgeRegistration, directory: string): Promise<void> {
  const latest = await readRegistration(directory, owner.id);
  if (["id", "port", "token", "cwd", "sessionId", "sessionFile"].some(key => latest[key as keyof CliBridgeRegistration] !== owner[key as keyof CliBridgeRegistration])) throw invalid();
}

async function getSnapshot(owner: CliBridgeRegistration, directory: string): Promise<CliBridgeSnapshot> {
  const result = snapshot(await exchange(owner), owner);
  await current(owner, directory);
  return result;
}

/** Credentials and endpoint addresses are never returned to the browser. */
export async function manageCliBridge(operation: CliBridgeOperation, options: { enabled: boolean; directory?: string }): Promise<Omit<CliBridgeReply, "requestId">> {
  if (!options.enabled) return { error: "CLI bridge access is disabled" };
  try {
    if (!object(operation)) throw invalid();
    const directory = directoryPath(options.directory);
    if (operation.action === "list") {
      if (!keys(operation, ["action"])) throw invalid();
      const owners = await registry(directory);
      const sessions = [];
      // Small batches bound simultaneous sockets while keeping discovery responsive.
      for (let i = 0; i < owners.length; i += 16) {
        sessions.push(...await Promise.all(owners.slice(i, i + 16).map(async owner => {
          try {
            const result = await getSnapshot(owner, directory);
            return { id: owner.id, cwd: result.cwd, sessionId: result.sessionId, activity: result.activity, inputGranted: result.inputGranted };
          } catch {
            await current(owner, directory);
            return { id: owner.id, cwd: owner.cwd, sessionId: owner.sessionId, activity: "unreachable" as const, inputGranted: false };
          }
        })));
      }
      return { sessions };
    }
    if ((operation.action !== "read" && operation.action !== "submit") || !string(operation.id, 36) || !UUID.test(operation.id)) throw invalid();
    if (operation.action === "read") {
      if (!keys(operation, ["action", "id"])) throw invalid();
      return { snapshot: await getSnapshot(await readRegistration(directory, operation.id), directory) };
    }
    if (!keys(operation, ["action", "id", "generation", "inputId", "text"]) || !string(operation.generation, 256) || !string(operation.inputId, 256) ||
        !string(operation.text, 8000) || !operation.text.trim() || /^[\/!]/.test(operation.text.trimStart())) throw invalid();
    const body = JSON.stringify({ generation: operation.generation, inputId: operation.inputId, text: operation.text });
    if (Buffer.byteLength(body) > MAX_FILE) throw invalid();
    const owner = await readRegistration(directory, operation.id);
    const state = await getSnapshot(owner, directory);
    // A working CLI queues the text as a follow-up; a terminal dialog keeps it out.
    if (!state.inputGranted || state.activity === "waiting" || state.generation !== operation.generation) throw invalid();
    const result = await exchange(owner, body);
    if (!object(result) || !keys(result, ["submitted"]) || result.submitted !== true) throw invalid();
    await current(owner, directory);
    return { submitted: true };
  } catch { return { error: "CLI bridge unavailable, invalid, or refused the request; submission outcome may be unknown" }; }
}

async function canonical(file: string): Promise<string> {
  try { return await realpath(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw invalid();
    const parent = path.dirname(file);
    if (parent === file) return file;
    return path.join(await canonical(parent), path.basename(file));
  }
}

/** Unsafe registries throw: callers must refuse mutation, not treat errors as unclaimed. */
export async function isCliSessionClaimed(sessionFile: string, directory?: string): Promise<boolean> {
  return (await findCliOwner(sessionFile, directory)) !== undefined;
}

/** The bridged CLI that has this session file open, compared canonically. Unsafe registries throw. */
export async function findCliOwner(sessionFile: string, directory?: string): Promise<CliBridgeRegistration | undefined> {
  const owners = await registry(directoryPath(directory));
  if (!owners.length) return undefined;
  const target = await canonical(path.resolve(sessionFile));
  for (const owner of owners) {
    if (owner.sessionFile && await canonical(owner.sessionFile) === target) return owner;
  }
  return undefined;
}

/** A POST to the owner. `connected` says whether the request may have reached it. */
function post(owner: CliBridgeRegistration, route: "/submit" | "/abort", body: string): Promise<{ status: number; value: unknown }> {
  return new Promise((resolve, reject) => {
    let connected = false;
    const req = request({ hostname: "127.0.0.1", port: owner.port, path: route, method: "POST", agent: false,
      headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_FILE) { fail(); response.destroy(); req.destroy(); return; }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        clearTimeout(timer);
        let value: unknown;
        try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { value = undefined; }
        resolve({ status: response.statusCode ?? 0, value });
      });
    });
    req.on("socket", socket => socket.once("connect", () => { connected = true; }));
    const timer = setTimeout(() => { fail(); req.destroy(); }, TIMEOUT);
    function fail() { clearTimeout(timer); reject(Object.assign(new Error("CLI bridge owner is unreachable"), { connected })); }
    req.on("error", fail);
    req.end(body);
  });
}

export type CliRouteResult = { outcome: "submitted" } | { outcome: "fallback" } | { outcome: "error"; message: string };

/**
 * Send a web prompt to the bridged CLI that has the session open. `fallback` only when the
 * owner provably did not take it (gone, unreachable before sending, or revoked); an unknown
 * outcome is an error and must never be resent elsewhere.
 */
export async function routeToCli(owner: CliBridgeRegistration, text: string, inputId: string, directory?: string): Promise<CliRouteResult> {
  let state: CliBridgeSnapshot;
  try {
    state = await getSnapshot(owner, directoryPath(directory));
  } catch { return { outcome: "fallback" }; }
  if (!state.inputGranted) return { outcome: "fallback" };
  if (state.activity === "waiting") return { outcome: "error", message: "The Pi CLI with this conversation is waiting on its terminal; answer there, then send again" };
  const body = JSON.stringify({ generation: state.generation, inputId, text });
  if (Buffer.byteLength(body) > MAX_FILE) return { outcome: "fallback" };
  let reply: { status: number; value: unknown };
  try {
    reply = await post(owner, "/submit", body);
  } catch (error) {
    if (!(error as { connected?: boolean }).connected) return { outcome: "fallback" };
    return { outcome: "error", message: "Sent to the Pi CLI, but its answer was lost; check the terminal before sending again" };
  }
  if (reply.status === 200 && object(reply.value) && reply.value.submitted === true) return { outcome: "submitted" };
  if (reply.status === 403) return { outcome: "fallback" };
  if (object(reply.value) && reply.value.uncertain === true) {
    return { outcome: "error", message: "The Pi CLI may have received this message; check the terminal before sending again" };
  }
  return { outcome: "error", message: "The Pi CLI with this conversation refused the message; it was not sent" };
}

/** Stop the bridged CLI's running turn. */
export async function abortCli(owner: CliBridgeRegistration): Promise<boolean> {
  try {
    const reply = await post(owner, "/abort", "{}");
    return reply.status === 200;
  } catch { return false; }
}

const MAX_EVENT = 512 * 1024;
const EVENT_TYPES = new Set(["agent_start", "agent_end", "assistant_start", "block_delta", "assistant_end", "tool_start", "tool_end"]);

function cliEvent(value: unknown): CliBridgeEvent | undefined {
  if (!object(value) || typeof value.type !== "string" || !EVENT_TYPES.has(value.type)) return undefined;
  if (value.type === "block_delta" && ((value.block !== "text" && value.block !== "thinking") || !Number.isInteger(value.contentIndex) || typeof value.delta !== "string")) return undefined;
  if ((value.type === "tool_start" || value.type === "tool_end") && (!string(value.toolCallId, 512) || !string(value.toolName, 256))) return undefined;
  if (value.type === "tool_end" && typeof value.isError !== "boolean") return undefined;
  if (value.type === "assistant_end" && !object(value.message)) return undefined;
  return value as CliBridgeEvent;
}

/** Follow the owner's live turn events until it closes; `onClose` runs once. */
export function followCliEvents(owner: CliBridgeRegistration, onEvent: (event: CliBridgeEvent) => void, onClose: () => void): () => void {
  let closed = false;
  const done = () => { if (!closed) { closed = true; onClose(); } };
  const req = request({ hostname: "127.0.0.1", port: owner.port, path: "/events", method: "GET", agent: false,
    headers: { authorization: `Bearer ${owner.token}` } }, response => {
    if (response.statusCode !== 200) { response.destroy(); done(); return; }
    let buffered = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      buffered += chunk;
      if (buffered.length > MAX_EVENT) { response.destroy(); done(); return; }
      let newline;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (!line.trim()) continue;
        let event: CliBridgeEvent | undefined;
        try { event = cliEvent(JSON.parse(line)); } catch { event = undefined; }
        if (event && !closed) onEvent(event);
      }
    });
    response.on("error", done);
    response.on("close", done);
  });
  req.on("error", done);
  req.end();
  return () => { closed = true; req.destroy(); };
}
