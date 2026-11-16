import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CliBridgeRegistration, CliBridgeSnapshot } from "../shared/src/cliBridge.ts";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { syncSessionFile, type SyncableSessionManager } from "../shared/src/sessionSync.ts";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MAX_BODY = 16 * 1024;
const MAX_SNAPSHOT = 512 * 1024;
const UNCERTAIN_AFTER = 30_000;
const MAX_EVENT = 256 * 1024;
const MAX_LISTENERS = 4;

/** Reject unsafe existing paths rather than silently repairing someone else's registry. */
function privateDirectory(directory: string): void {
  const parent = dirname(directory);
  if (parent !== directory) {
    const ancestors: string[] = [];
    for (let p = parent; ; p = dirname(p)) {
      ancestors.push(p);
      if (dirname(p) === p) break;
    }
    for (const p of ancestors.reverse()) {
      let stat;
      try { stat = lstatSync(p); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        mkdirSync(p, { mode: 0o700 });
        stat = lstatSync(p);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe bridge directory");
      if (process.platform !== "win32" &&
          ((stat.uid !== process.getuid!() && stat.uid !== 0) ||
           ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000))))) {
        throw new Error("Unsafe bridge ancestor");
      }
    }
  }
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0))) {
    throw new Error("Unsafe bridge registry");
  }
}

function readable(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { role?: string; content?: unknown; toolName?: string };
  if (!["user", "assistant", "toolResult", "custom"].includes(m.role ?? "")) return "";
  let text = "";
  if (typeof m.content === "string") text = m.content.slice(-60_000);
  else if (Array.isArray(m.content)) {
    for (const block of m.content.slice(-100)) {
      if (block?.type === "text" && typeof block.text === "string") text += block.text.slice(-60_000);
      else if (block?.type === "toolCall") text += `\n[tool: ${String(block.name).slice(0, 100)}]`;
      text = text.slice(-60_000);
    }
  }
  return text ? `${m.role}${m.toolName ? ` (${m.toolName.slice(0, 100)})` : ""}:\n${text}` : "";
}

/**
 * Opt-in, in-process owner. Never writes the CLI's session file; in a terminal it re-reads
 * it between turns, so what Outpost web appended to the same file reaches the next request.
 */
export default function cliSessionBridge(pi: ExtensionAPI): void {
  const instanceId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const directory = resolve(process.env.PI_OUTPOST_BRIDGE_DIR ?? join(homedir(), ".pi", "outpost-bridges"));
  const registrationPath = join(directory, `${instanceId}.json`);
  let ctx: ExtensionContext | undefined;
  let generation = randomUUID();
  // Outpost web may send by default (the user's accepted risk); `/outpost-bridge revoke` stops it for this CLI.
  let revoked = false;
  let waiting = false;
  let active = false;
  let partial = "";
  let pending: { at: number; text: string } | undefined;
  // Never evict IDs within a generation: at capacity fail closed instead of allowing replay.
  const submissions = new Map<string, { hash: string; uncertain: boolean }>();
  let ownedBytes: string | undefined;
  let port = 0;

  function publish(): void {
    if (!ctx || !active) return;
    privateDirectory(directory);
    if (ownedBytes !== undefined && !ownsRegistration()) throw new Error("Bridge registration changed");
    const registration: CliBridgeRegistration = {
      version: 1, id: instanceId, port, token, cwd: ctx.cwd,
      sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
    };
    const bytes = JSON.stringify(registration);
    const temporary = join(directory, `.${instanceId}-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      renameSync(temporary, registrationPath);
      ownedBytes = bytes;
    } finally {
      try { unlinkSync(temporary); } catch { /* Already renamed or never created. */ }
    }
  }
  function ownsRegistration(): boolean {
    try {
      privateDirectory(directory);
      const stat = lstatSync(registrationPath);
      return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
        (process.platform === "win32" || (stat.uid === process.getuid!() && (stat.mode & 0o077) === 0)) &&
        stat.size <= 32 * 1024 && readFileSync(registrationPath, "utf8") === ownedBytes;
    } catch { return false; }
  }
  function snapshot(): CliBridgeSnapshot {
    if (!ctx) throw new Error("Bridge unavailable");
    const entries = ctx.sessionManager.getBranch();
    const lines: string[] = [];
    for (const entry of entries.slice(-100)) {
      if (entry.type === "message") {
        const line = readable(entry.message);
        if (line) lines.push(line);
      } else if (entry.type === "custom_message" && entry.display) {
        const line = readable({ role: "custom", content: entry.content });
        if (line) lines.push(line);
      }
    }
    if (partial) lines.push(`[streaming]\n${partial}`);
    const result: CliBridgeSnapshot = {
      instanceId, generation, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      activity: waiting || (pending && Date.now() - pending.at >= UNCERTAIN_AFTER) ? "waiting" :
        pending || !ctx.isIdle() || ctx.hasPendingMessages() ? "working" : "idle",
      inputGranted: !revoked, transcript: lines.join("\n\n").slice(-60_000),
      truncated: entries.length > 100 || lines.join("\n\n").length > 60_000 || lines.some(line => line.length >= 60_000),
    };
    // Check the encoded size too: JSON escaping and metadata count against the wire bound.
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_SNAPSHOT) throw new Error("Snapshot too large");
    return result;
  }
  // Live turn events for Outpost web (tau-style mirroring); the session file stays the record.
  const listeners = new Set<ServerResponse>();
  function stream(event: Record<string, unknown>): void {
    if (!listeners.size) return;
    let line = JSON.stringify(event);
    if (Buffer.byteLength(line) > MAX_EVENT) {
      // Too large to stream: the file sync after the turn shows the full content.
      if (event.type === "tool_start") line = JSON.stringify({ ...event, args: {} });
      else if (event.type === "tool_end") line = JSON.stringify({ ...event, content: [{ type: "text", text: "(output shown when the turn ends)" }], details: undefined });
      else return;
    }
    for (const res of listeners) res.write(line + "\n");
  }
  function reply(res: ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  }
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (!active || supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || req.headers.origin) {
      req.resume(); reply(res, 401, { error: "Unauthorized" }); return;
    }
    if (req.method === "GET" && req.url === "/snapshot") {
      try { reply(res, 200, snapshot()); } catch { reply(res, 503, { error: "Snapshot unavailable" }); }
      return;
    }
    if (req.method === "GET" && req.url === "/events") {
      if (listeners.size >= MAX_LISTENERS) { reply(res, 429, { error: "Too many listeners" }); return; }
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
      res.write("\n");
      listeners.add(res);
      res.on("close", () => listeners.delete(res));
      return;
    }
    if (req.method === "POST" && req.url === "/abort") {
      req.resume();
      if (revoked || !ctx) { reply(res, 403, { error: "Input revoked" }); return; }
      ctx.abort();
      reply(res, 200, { aborted: true });
      return;
    }
    if (req.method !== "POST" || req.url !== "/submit") {
      req.resume(); reply(res, 404, { error: "Not found" }); return;
    }
    let body = "";
    let size = 0;
    req.setTimeout(5000, () => req.destroy());
    req.on("error", () => {});
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!res.writableEnded) reply(res, 413, { error: "Input too large" });
        return;
      }
      body += chunk.toString("latin1");
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let input;
      try { input = JSON.parse(Buffer.from(body, "latin1").toString("utf8")); } catch {
        reply(res, 400, { error: "Invalid JSON" }); return;
      }
      if (!input || typeof input !== "object" || typeof input.text !== "string" ||
          !input.text.trim() || input.text.length > 8000 || /^[\s]*[\/!]/u.test(input.text) ||
          typeof input.inputId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.inputId)) {
        reply(res, 400, { error: "Invalid plain-text input" }); return;
      }
      if (!active || !ctx || input.generation !== generation) { reply(res, 409, { error: "Stale generation" }); return; }
      const hash = createHash("sha256").update(input.text).digest("hex");
      const prior = submissions.get(input.inputId);
      if (prior) {
        reply(res, prior.hash !== hash || prior.uncertain ? 409 : 200,
          prior.hash !== hash ? { error: "Input ID reused" } : prior.uncertain ? { error: "Submission uncertain; inspect terminal", uncertain: true } : { submitted: true });
        return;
      }
      if (revoked) { reply(res, 403, { error: "Input revoked" }); return; }
      // A terminal dialog, or a submission not yet started, would race a second prompt.
      if (waiting || pending) { reply(res, 409, { error: "Owner is waiting on the terminal" }); return; }
      if (submissions.size >= 4096) { reply(res, 409, { error: "Submission capacity reached; start a new generation" }); return; }
      const record = { hash, uncertain: false };
      submissions.set(input.inputId, record);
      // While a turn runs the text waits as a follow-up, as if typed in the terminal then.
      if (ctx.isIdle() && !ctx.hasPendingMessages()) pending = { at: Date.now(), text: input.text };
      try {
        pi.sendUserMessage(input.text, { deliverAs: "followUp", expandPromptTemplates: false });
        reply(res, 200, { submitted: true });
      } catch {
        record.uncertain = true;
        reply(res, 409, { error: "Submission uncertain; inspect terminal", uncertain: true });
      }
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.on("error", () => { active = false; });

  pi.on("session_start", async (_event, context) => {
    ctx = context;
    if (ctx.mode !== "tui") return;
    privateDirectory(directory);
    generation = randomUUID();
    await new Promise<void>((accept, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); accept(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Bridge unavailable");
    port = address.port;
    active = true;
    try { publish(); } catch {
      active = false; server.close(); throw new Error("Bridge registration refused");
    }
    ctx.ui.notify(revoked ? "Outpost web input is revoked for this CLI. /outpost-bridge allow to restore." : "Outpost web can send messages to this CLI. /outpost-bridge revoke to stop.", "info");
  });
  pi.registerCommand("outpost-bridge", {
    description: "Stop (revoke) or restore (allow) Outpost web input to this CLI",
    handler: async (args, context) => {
      if (!active || context.mode !== "tui") return;
      if (args.trim() === "revoke") { revoked = true; context.ui.notify("Outpost web input revoked for this CLI.", "info"); return; }
      if (args.trim() === "allow") { revoked = false; context.ui.notify("Outpost web can send messages to this CLI. /outpost-bridge revoke to stop.", "info"); return; }
      context.ui.notify("Usage: /outpost-bridge revoke | allow", "info");
    },
  });
  // Outpost web may append to this same file. Re-read it between turns: the SDK builds each
  // request from the SessionManager, so its messages reach the model and the next entry
  // chains after the web's last one. The terminal scrollback does not redraw, hence the notice.
  type Followed = { file: string; watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> };
  let followed: Followed | undefined;
  function syncFromWeb(context: ExtensionContext | undefined): void {
    if (!context || context.mode !== "tui" || !context.isIdle() || context.hasPendingMessages()) return;
    try {
      const messages = () => context.sessionManager.getEntries().filter((entry) => entry.type === "message").length;
      const before = messages();
      if (syncSessionFile(context.sessionManager as unknown as SyncableSessionManager)) {
        context.ui.notify(`Synced ${messages() - before} new messages from Outpost web`, "info");
      }
    } catch { /* A file mid-rewrite is read again on its next change. */ }
  }
  function follow(): void {
    const file = ctx?.mode === "tui" ? ctx.sessionManager.getSessionFile() : undefined;
    if (followed && followed.file !== file) { followed.watcher.close(); clearTimeout(followed.timer); followed = undefined; }
    if (file && !followed) {
      try {
        const next: Followed = { file, watcher: watch(file, () => {
          clearTimeout(next.timer);
          next.timer = setTimeout(() => syncFromWeb(ctx), 300);
        }) };
        next.watcher.on("error", () => {});
        followed = next;
      } catch { /* Not written yet: the next poll tries again. */ }
    }
    syncFromWeb(ctx);
  }
  const poll = setInterval(follow, 2000);
  poll.unref();
  pi.on("input", (_event, context) => { syncFromWeb(context); });
  pi.on("ui_prompt_start", () => { waiting = true; });
  pi.on("ui_prompt_end", () => { waiting = false; });
  pi.on("message_start", (event) => {
    if (event.message.role === "user" && pending && readable(event.message) === `user:\n${pending.text}`) pending = undefined;
    if (event.message.role === "assistant") stream({ type: "assistant_start" });
  });
  pi.on("agent_start", () => stream({ type: "agent_start" }));
  pi.on("agent_end", () => stream({ type: "agent_end" }));
  pi.on("message_update", (event) => {
    partial = readable(event.message);
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_delta" || delta?.type === "thinking_delta") {
      stream({ type: "block_delta", block: delta.type === "text_delta" ? "text" : "thinking", contentIndex: delta.contentIndex, delta: delta.delta });
    }
  });
  pi.on("tool_execution_start", (event) => {
    if (event.parentToolCallId === undefined) stream({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args ?? {} });
  });
  pi.on("tool_execution_end", (event) => {
    if (event.parentToolCallId === undefined) {
      stream({ type: "tool_end", toolCallId: event.toolCallId, toolName: event.toolName, content: event.result?.content ?? [], details: event.result?.details, isError: event.isError ?? false });
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") { partial = ""; stream({ type: "assistant_end", message: event.message }); }
    // A new session may acquire its file only after its first persisted message.
    if (active && ctx && ownedBytes) {
      const previous = JSON.parse(ownedBytes) as CliBridgeRegistration;
      if (previous.sessionFile !== ctx.sessionManager.getSessionFile() || previous.sessionId !== ctx.sessionManager.getSessionId()) {
        generation = randomUUID();
        try { publish(); } catch { active = false; server.close(); }
      }
    }
  });
  pi.on("agent_settled", () => { pending = undefined; partial = ""; });
  pi.on("session_tree", (_event, context) => {
    ctx = context; generation = randomUUID(); pending = undefined; partial = ""; submissions.clear();
    try { publish(); } catch { active = false; server.close(); }
  });
  pi.on("session_shutdown", async () => {
    active = false; ctx = undefined;
    for (const res of listeners) res.end();
    listeners.clear();
    clearInterval(poll); followed?.watcher.close(); clearTimeout(followed?.timer); followed = undefined;
    try {
      if (ownedBytes !== undefined && ownsRegistration()) unlinkSync(registrationPath);
    } catch { /* Keep the stale claim if cleanup fails; still close the endpoint. */ }
    ownedBytes = undefined;
    await new Promise<void>(accept => { server.close(() => accept()); server.closeAllConnections(); });
  });
}
