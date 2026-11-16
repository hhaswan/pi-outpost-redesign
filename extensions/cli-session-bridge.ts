import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CliBridgeRegistration, CliBridgeSnapshot } from "../shared/src/cliBridge.ts";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assertCliHandoffNotReserved, createCliHandoff } from "../shared/src/cliHandoffStore.ts";

const MAX_BODY = 16 * 1024;
const MAX_SNAPSHOT = 512 * 1024;
const UNCERTAIN_AFTER = 30_000;

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

/** Opt-in, in-process owner. Never opens or writes the CLI's session file. */
export default function cliSessionBridge(pi: ExtensionAPI): void {
  const instanceId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const directory = resolve(process.env.PI_OUTPOST_BRIDGE_DIR ?? join(homedir(), ".pi", "outpost-bridges"));
  const registrationPath = join(directory, `${instanceId}.json`);
  const handoffDirectory = resolve(process.env.PI_OUTPOST_HANDOFF_DIR ?? join(homedir(), ".pi", "outpost-handoffs"));
  let ctx: ExtensionContext | undefined;
  let generation = randomUUID();
  let granted = false;
  let grantEpoch = 0;
  let waiting = false;
  let active = false;
  let partial = "";
  let pending: { at: number; text: string } | undefined;
  let handingOff = false;
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
      inputGranted: granted, transcript: lines.join("\n\n").slice(-60_000),
      truncated: entries.length > 100 || lines.join("\n\n").length > 60_000 || lines.some(line => line.length >= 60_000),
    };
    // Check the encoded size too: JSON escaping and metadata count against the wire bound.
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_SNAPSHOT) throw new Error("Snapshot too large");
    return result;
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
          prior.hash !== hash ? { error: "Input ID reused" } : prior.uncertain ? { error: "Submission uncertain; inspect terminal" } : { submitted: true });
        return;
      }
      if (!granted) { reply(res, 403, { error: "Input not granted" }); return; }
      if (handingOff || waiting || pending || !ctx.isIdle() || ctx.hasPendingMessages()) { reply(res, 409, { error: "Owner not idle" }); return; }
      if (submissions.size >= 4096) { reply(res, 409, { error: "Submission capacity reached; start a new generation" }); return; }
      const record = { hash, uncertain: false };
      submissions.set(input.inputId, record);
      pending = { at: Date.now(), text: input.text };
      try {
        pi.sendUserMessage(input.text, { expandPromptTemplates: false });
        reply(res, 200, { submitted: true });
      } catch {
        record.uncertain = true;
        reply(res, 409, { error: "Submission uncertain; inspect terminal" });
      }
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.on("error", () => { active = false; granted = false; });

  pi.on("session_start", async (_event, context) => {
    ctx = context;
    if (ctx.mode !== "tui") return;
    privateDirectory(directory);
    try { await assertCliHandoffNotReserved(ctx.sessionManager.getSessionFile(), handoffDirectory); }
    catch {
      ctx.ui.notify("This session is reserved for an Outpost handoff. Continue in web; do not open another CLI writer.", "error");
      ctx.shutdown();
      return;
    }
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
    ctx.ui.notify("Outpost bridge observing. /outpost-bridge allow grants idle input; /outpost-bridge handoff releases this session to web and closes CLI.", "info");
  });
  pi.registerCommand("outpost-bridge", {
    description: "Allow/revoke Outpost idle input, or hand off this same session file to web and close CLI (terminal confirmation required)",
    handler: async (args, context) => {
      if (!active || context.mode !== "tui") return;
      if (args.trim() === "handoff") {
        if (handingOff || waiting || !context.isIdle() || context.hasPendingMessages()) {
          context.ui.notify("Cannot hand off while CLI is busy or waiting for input.", "error");
          return;
        }
        const before = generation;
        const sessionId = context.sessionManager.getSessionId();
        const sessionFile = context.sessionManager.getSessionFile();
        handingOff = true;
        let released = false;
        try {
          const confirmed = await context.ui.confirm("Continue this session in Outpost?", "This closes this CLI after its current session is safely released. Web will continue the SAME session file, not a copy. Submitted text without a transcript entry may not be in the history; inspect the transcript before confirming. Confirm only when you want to stop using this CLI.");
          if (!confirmed) return;
          if (!active || before !== generation || !context.isIdle() || context.hasPendingMessages() || waiting ||
              context.sessionManager.getSessionId() !== sessionId || context.sessionManager.getSessionFile() !== sessionFile || !sessionFile) {
            context.ui.notify("Session changed or is no longer idle. Handoff was not released.", "error");
            return;
          }
          await createCliHandoff({ bridgeId: instanceId, cwd: context.cwd, sessionId, sessionFile }, handoffDirectory);
          grantEpoch++; granted = false;
          released = true;
          context.ui.notify("Handoff prepared. CLI is closing; open Terminal sessions in this project and refresh released sessions to continue in web.", "info");
          context.shutdown();
        } catch {
          context.ui.notify("Handoff failed. No web writer is authorized while this CLI process is alive.", "error");
        } finally { if (!released) handingOff = false; }
        return;
      }
      if (args.trim() === "revoke") { grantEpoch++; granted = false; context.ui.notify("Outpost input revoked.", "info"); return; }
      if (args.trim() !== "allow") { context.ui.notify("Usage: /outpost-bridge allow | revoke | handoff", "info"); return; }
      const before = generation;
      const epoch = ++grantEpoch;
      const confirmed = await context.ui.confirm("Allow Outpost input?", "Authorized web operators may submit plain text while this CLI is idle. Tools may execute with your CLI permissions. Terminal dialogs stay here.");
      if (active && before === generation && epoch === grantEpoch && confirmed) granted = true;
    },
  });
  pi.on("session_before_switch", async (event, context) => {
    // Web also auto-loads this extension; its RPC host already validates the writer lease.
    if (context.mode !== "tui" || event.reason !== "resume" || !event.targetSessionFile) return;
    try { await assertCliHandoffNotReserved(event.targetSessionFile, handoffDirectory); }
    catch {
      context.ui.notify("This session is reserved for an Outpost handoff. Continue in its web workspace instead.", "error");
      return { cancel: true };
    }
  });
  pi.on("input", () => handingOff ? { action: "handled" as const } : undefined);
  pi.on("ui_prompt_start", () => { waiting = true; });
  pi.on("ui_prompt_end", () => { waiting = false; });
  pi.on("message_start", (event) => {
    if (event.message.role === "user" && pending && readable(event.message) === `user:\n${pending.text}`) pending = undefined;
  });
  pi.on("message_update", (event) => { partial = readable(event.message); });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") partial = "";
    // A new session may acquire its file only after its first persisted message.
    if (active && ctx && ownedBytes) {
      const previous = JSON.parse(ownedBytes) as CliBridgeRegistration;
      if (previous.sessionFile !== ctx.sessionManager.getSessionFile() || previous.sessionId !== ctx.sessionManager.getSessionId()) {
        generation = randomUUID(); granted = false;
        try { publish(); } catch { active = false; server.close(); }
      }
    }
  });
  pi.on("agent_settled", () => { pending = undefined; partial = ""; });
  pi.on("session_tree", (_event, context) => {
    ctx = context; generation = randomUUID(); granted = false; pending = undefined; partial = ""; submissions.clear();
    try { publish(); } catch { active = false; granted = false; server.close(); }
  });
  pi.on("session_shutdown", async () => {
    active = false; granted = false; ctx = undefined;
    try {
      if (ownedBytes !== undefined && ownsRegistration()) unlinkSync(registrationPath);
    } catch { /* Keep the stale claim if cleanup fails; still close the endpoint. */ }
    ownedBytes = undefined;
    await new Promise<void>(accept => { server.close(() => accept()); server.closeAllConnections(); });
  });
}
