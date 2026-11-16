import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { syncSessionFile } from "../../shared/src/sessionSync.ts";
import { EmbeddedRuntime } from "../src/embeddedRuntime.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as bridgeModule from "../../extensions/cli-session-bridge.ts";

// The extension lives outside this ESM package: its default export arrives CommonJS-wrapped.
const bridge = ((bridgeModule.default as unknown as { default?: unknown }).default ?? bridgeModule.default) as (pi: ExtensionAPI) => void;

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() });
const assistant = (text: string) => ({
  role: "assistant" as const, content: [{ type: "text" as const, text }], api: "fake", provider: "fake", model: "fake",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop" as const, timestamp: Date.now(),
});

/** Two writers on one file, the way Outpost web and the Pi CLI share it. */
function pair(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "session-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const web = SessionManager.create(root, root);
  web.appendMessage(user("from web"));
  web.appendMessage(assistant("web answer"));
  const cli = SessionManager.open(web.getSessionFile()!, root);
  return { web, cli, file: web.getSessionFile()! };
}

const lines = (file: string) => readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

// openlore: scenario=WebPromptChainsAfterCliEntries spec=shared-cli-web-sessions
test("SharedFileChainsAfterOtherWriter: an external append is picked up and the next entry chains after it", (t) => {
  const { web, cli, file } = pair(t);
  assert.equal(syncSessionFile(web), 0, "nothing changed yet");
  cli.appendMessage(user("from cli"));
  const cliLast = cli.appendMessage(assistant("cli answer"));
  assert.equal(syncSessionFile(web), 2);
  assert.deepEqual(web.buildSessionProjection().messages.map((m) => (m as { content: { text: string }[] }).content[0].text),
    ["from web", "web answer", "from cli", "cli answer"]);
  const next = web.appendMessage(user("web again"));
  assert.equal(lines(file).find((entry) => entry.id === next).parentId, cliLast);
  assert.equal(syncSessionFile(web), 0, "its own append is not an external change");
  assert.equal(syncSessionFile(cli), 1);
  const entries = lines(file).slice(1);
  entries.forEach((entry, i) => assert.equal(entry.parentId, i === 0 ? null : entries[i - 1].id, "one linear chain"));
});

test("SharedFileKeepsNavigation: a leaf moved off the tip stays where the user put it", (t) => {
  const { web, cli } = pair(t);
  const first = web.getEntries()[0].id;
  web.branch(first);
  cli.appendMessage(user("from cli"));
  assert.equal(syncSessionFile(web), 1);
  assert.equal(web.getLeafId(), first);
});

// openlore: scenario=OtherWritersBranchIsFollowed spec=shared-cli-web-sessions
test("SharedFileBranch: an append under an older parent is read as a branch, and the next entry chains after the file's last", (t) => {
  const { web, file } = pair(t);
  const [question, answer] = web.getEntries().map((entry) => entry.id);
  web.appendMessage(user("web second"));
  const webTip = web.appendMessage(assistant("web second answer"));
  // The other writer had not seen "web second": its turn hangs off the first answer.
  const branch = { type: "message", id: "cli00001", parentId: answer, timestamp: new Date().toISOString(), message: user("cli on a stale leaf") };
  appendFileSync(file, `${JSON.stringify(branch)}\n`);
  assert.equal(syncSessionFile(web), 1);
  assert.equal(web.getLeafId(), "cli00001", "at the tip, the leaf follows the file's last entry");
  const children = web.getTree()[0].children[0].children.map((node) => node.entry.id);
  assert.equal(web.getTree()[0].entry.id, question);
  assert.equal(children.length, 2, "both branches are in the tree");
  assert.ok(children.includes("cli00001"));
  assert.ok(web.getEntry(webTip), "the web branch is kept");
  const next = web.appendMessage(assistant("web answers the cli branch"));
  assert.equal(lines(file).find((entry) => entry.id === next).parentId, "cli00001");
  assert.equal(syncSessionFile(web), 0);
});

// openlore: scenario=NoSyncDuringATurn spec=shared-cli-web-sessions
test("SharedFileNotMidTurn: the embedded runtime refuses to re-read while streaming and refreshes its context when idle", (t) => {
  const { web, cli } = pair(t);
  let refreshed = 0;
  const session = { isStreaming: true, isCompacting: false, sessionManager: web, refreshContext: () => { refreshed += 1; } };
  const runtime = new EmbeddedRuntime({ session } as never, "/nowhere");
  cli.appendMessage(user("from cli"));
  assert.equal(runtime.syncFromFile(), false);
  assert.equal(web.getEntries().length, 2, "a running turn keeps what it holds");
  session.isStreaming = false;
  assert.equal(runtime.syncFromFile(), true);
  assert.equal(refreshed, 1);
  assert.equal(web.getEntries().length, 3);
  assert.equal(runtime.syncFromFile(), false);
});

// openlore: scenario=CliPromptChainsAfterWebEntries spec=shared-cli-web-sessions
test("CliSyncsOnInput: the terminal bridge re-reads web entries before a prompt and says so", async (t) => {
  const { web, cli } = pair(t);
  const handlers = new Map<string, Function>();
  const notices: string[] = [];
  let idle = true;
  const context = {
    mode: "tui", cwd: "/", isIdle: () => idle, hasPendingMessages: () => false, sessionManager: cli,
    ui: { notify: (text: string) => notices.push(text), confirm: async () => false },
  };
  bridge({ on: (name: string, fn: Function) => handlers.set(name, fn), registerCommand() {}, sendUserMessage() {} } as unknown as ExtensionAPI);
  t.after(() => handlers.get("session_shutdown")?.({}, context));
  web.appendMessage(user("typed in web"));
  idle = false;
  await handlers.get("input")!({ text: "x" }, context);
  assert.equal(cli.getEntries().length, 2, "never mid-turn");
  idle = true;
  await handlers.get("input")!({ text: "x" }, context);
  assert.equal(cli.getEntries().length, 3);
  assert.deepEqual(notices, ["Synced 1 new messages from Outpost web"]);
});
