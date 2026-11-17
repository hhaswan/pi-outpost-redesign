#!/usr/bin/env node
/** Explicit Linux/root integration probe. Never touches pi-outpost.service. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { get } from "node:http";
import { get as httpsGet } from "node:https";
import WebSocket, { WebSocketServer } from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { freePort, makeWorkspace, connect } from "../server/test/harness.mjs";
import { DEPLOY_ADDRESS, lockIngress, unlockIngress } from "./native-deploy-network.mjs";

assert.equal(process.platform, "linux");
assert.equal(process.getuid(), 0);
const repo = process.cwd();
const script = await fs.readFile("scripts/deploy-custom-native.mjs", "utf8");
const helpers = script.slice(script.indexOf("async function connection("), script.indexOf("async function verifyBrowser("));
function helper(port, token, tls) {
  const live = { scheme: tls ? "https" : "http", authorization: `Bearer ${token}`, ...(tls ? { ca: tls.ca } : {}) };
  return new Function("WebSocket", "port", "live", "DEPLOY_ADDRESS", `${helpers}; return {connection,restore,quiet};`)(WebSocket, port, live, DEPLOY_ADDRESS);
}
/** GET over HTTPS trusting only the given CA. */
function httpsStatus(url, ca) {
  return new Promise((resolve, reject) => {
    httpsGet(url, { ca }, (response) => { response.resume(); resolve(response.statusCode); }).on("error", reject);
  });
}
const mock = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve) => mock.once("listening", resolve));
let refuse = false;
mock.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "hello", sessionId: "initial", workspace: { root: "/fixture" } }));
  socket.send(JSON.stringify({ type: "session_replaced", sessionId: "stale", workspace: { root: "/fixture" } }));
  socket.on("message", () => {
    if (refuse) { socket.send(JSON.stringify({ type: "error", message: "Refused by owner" })); return; }
    socket.send(JSON.stringify({ type: "error", message: "Unrelated extension warning" }));
    socket.send(JSON.stringify({ type: "session_replaced", sessionId: "intermediate", workspace: { root: "/fixture" } }));
    setTimeout(() => socket.send(JSON.stringify({ type: "session_replaced", sessionId: "target", workspace: { root: "/fixture" } })), 15);
  });
});
try {
  const mockHelpers = helper(mock.address().port, "test");
  await mockHelpers.restore([{ root: "/fixture", sessionId: "target", path: "/fixture/saved" }]);
  refuse = true;
  await assert.rejects(mockHelpers.restore([{ root: "/fixture", sessionId: "target", path: "/fixture/saved" }], 100), /timed out/);
  assert.equal(mockHelpers.quiet({ isStreaming: true, workspaces: [] }), false);
  assert.equal(mockHelpers.quiet({ isStreaming: false, workspaces: [{ activity: "idle", backgroundAgents: { known: true, running: 0, queued: 0 } }] }), true);
  for (const activity of ["working", "waiting", "starting"]) assert.equal(mockHelpers.quiet({ workspaces: [{ activity }] }), false);
  for (const backgroundAgents of [{ known: false }, { known: true, running: 1 }, { known: true, queued: 1 }]) {
    assert.equal(mockHelpers.quiet({ workspaces: [{ activity: "idle", backgroundAgents }] }), false);
  }
  console.log("PASS ExactSessionRestorationAndBusyGuards");
} finally {
  for (const client of mock.clients) client.terminate();
  await new Promise((resolve) => mock.close(resolve));
}

const root = await makeWorkspace();
const home = path.join(root, "home"), agentDir = path.join(root, "agent");
const service = `pi-outpost-deploy-proof-${process.pid}.service`;
const unit = path.join("/run/systemd/system", service);
const dropInDir = path.join("/etc/systemd/system", `${service}.d`);
const resultPath = path.join(repo, ".local/deploy-result.json");
const previousResult = await fs.readFile(resultPath).catch(() => null);
const port = await freePort();
const configPath = path.join(root, "config.json");
const systemctl = (...args) => execFileSync("systemctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let client, proofRecord;
const releases = [];
try {
  await fs.mkdir(path.join(home, ".pi/agent/extensions"), { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [], extensions: [], skills: [] }));
  const manager = SessionManager.create(root, path.join(agentDir, "sessions"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Native deployment proof" }] });
  const id = manager.getSessionId();
  await fs.writeFile(configPath, JSON.stringify({ cwd: root, agentDir, sandbox: false, noExtensions: true,
    noSkills: true, noPromptTemplates: true, webContext: false, openBrowser: false, offline: true,
    server: { host: "127.0.0.1", port, token: "test" } }), { mode: 0o600 });
  await fs.writeFile(unit, `[Unit]\nDescription=Disposable custom deployment proof\n[Service]\nWorkingDirectory=${repo}\nEnvironment="HOME=${home}" "PI_OFFLINE=1" "ANTHROPIC_API_KEY=fixture-no-model-calls"\nExecStart=${process.execPath} ${path.join(repo, "cli/dist/pi-outpost.mjs")} --config ${configPath}\n`);
  systemctl("daemon-reload"); systemctl("start", service);
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) { healthy = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(healthy, "disposable service must start");
  client = connect(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: "Bearer test" } }); await client.waitFor("hello");
  client.send({ type: "switch_session", path: manager.getSessionFile() });
  await client.waitFor((message) => message.type === "session_replaced" && message.sessionId === id);
  client.close(); client = undefined;
  lockIngress(port);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  const bypassStatus = await new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path: "/health", localAddress: DEPLOY_ADDRESS }, (response) => {
      response.resume(); resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(bypassStatus, 200);
  unlockIngress(port);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  console.log("PASS TemporaryIngressExcludesClientsAndCleansUp");
  await promisify(execFile)(process.execPath, [path.join(repo, "scripts/deploy-custom-native.mjs"), configPath, service], {
    cwd: repo, timeout: 180_000, env: { ...process.env, HOME: home },
  });
  proofRecord = JSON.parse(await fs.readFile(resultPath, "utf8"));
  assert.equal(proofRecord.service, service);
  assert.equal(proofRecord.status, "deployed");
  releases.push(proofRecord.release);
  assert.equal(proofRecord.restoredSessions, 1);
  assert.ok(systemctl("show", service, "-p", "ExecStart", "--value").includes(path.join(proofRecord.release, "dist/pi-outpost.mjs")));
  const fresh = await helper(port, "test").connection(root);
  assert.equal(fresh.hello.sessionId, id); fresh.close();
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  assert.ok(await fs.stat(path.join(home, ".pi/agent/extensions/pi-outpost-cli-bridge.js")));
  const previousEntry = path.join(proofRecord.release, "dist/pi-outpost.mjs");
  const second = SessionManager.create(root, path.join(agentDir, "sessions"));
  second.appendMessage({ role: "user", content: [{ type: "text", text: "Selection made after deployment" }] });
  const marker = path.join(root, "browser-started");
  const fakeBrowser = path.join(root, "fake-browser.cjs");
  await fs.writeFile(fakeBrowser, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\nsetTimeout(() => process.exit(1), 5000);\n`, { mode: 0o755 });
  const failingWorker = promisify(execFile)(process.execPath, [path.join(repo, "scripts/deploy-custom-native.mjs"), configPath, service], {
    cwd: repo, timeout: 180_000, env: { ...process.env, HOME: home, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: fakeBrowser },
  }).then(() => ({ ok: true }), (error) => ({ error }));
  let browserStarted = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await fs.stat(marker).catch(() => null)) { browserStarted = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(browserStarted, "fault-injection browser must reach the post-restoration phase");
  client = connect(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: "Bearer test" } }); await client.waitFor("hello");
  client.send({ type: "switch_session", path: second.getSessionFile() });
  await client.waitFor((message) => message.type === "session_replaced" && message.sessionId === second.getSessionId());
  client.close(); client = undefined;
  assert.equal((await failingWorker).error?.code, 1);
  const rollback = JSON.parse(await fs.readFile(resultPath, "utf8"));
  if (rollback.release) releases.push(rollback.release);
  assert.equal(rollback.status, "rolled-back");
  assert.ok(systemctl("show", service, "-p", "ExecStart", "--value").includes(previousEntry));
  const afterRollback = await helper(port, "test").connection(root);
  assert.equal(afterRollback.hello.sessionId, second.getSessionId()); afterRollback.close();
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  console.log("PASS RollbackPreservesSelectionMadeAfterIngressReopened");

  // The HTTPS cutover as the runbook does it: tls init, token rotate, then deploy with the
  // previous configuration describing the still-running plain-HTTP server.
  const cliEnv = { ...process.env, HOME: home, PI_OFFLINE: "1" };
  delete cliEnv.XDG_CONFIG_HOME;
  delete cliEnv.PI_OUTPOST_TOKEN;
  const previousConfig = `${configPath}.pre-https`;
  await fs.copyFile(configPath, previousConfig);
  const cliEntry = path.join(repo, "cli/dist/pi-outpost.mjs");
  await promisify(execFile)(process.execPath, [cliEntry, "tls", "init", "--ip", "127.0.0.1", "--config", configPath], { cwd: repo, env: cliEnv });
  await promisify(execFile)(process.execPath, [cliEntry, "token", "rotate", "--config", configPath], { cwd: repo, env: cliEnv });
  const cutover = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.ok(cutover.server.tls?.caFile && cutover.server.token !== "test");
  const ca = await fs.readFile(cutover.server.tls.caFile);
  await promisify(execFile)(process.execPath, [path.join(repo, "scripts/deploy-custom-native.mjs"), configPath, service, "--previous-config", previousConfig], {
    cwd: repo, timeout: 240_000, env: { ...process.env, HOME: home },
  });
  const tlsRecord = JSON.parse(await fs.readFile(resultPath, "utf8"));
  releases.push(tlsRecord.release);
  assert.equal(tlsRecord.status, "deployed");
  assert.ok(tlsRecord.checks.some((check) => check.includes("Playwright over https")));
  assert.equal(await httpsStatus(`https://127.0.0.1:${port}/health`, ca), 200);
  const plain = await fetch(`http://127.0.0.1:${port}/health?token=x`, { redirect: "manual" });
  assert.equal(plain.status, 301);
  assert.equal(plain.headers.get("location"), `https://127.0.0.1:${port}/`);
  const secure = await helper(port, cutover.server.token, { ca }).connection(root);
  assert.equal(secure.hello.sessionId, second.getSessionId(), "the selection survived the cutover"); secure.close();
  await assert.rejects(helper(port, "test", { ca }).connection(root), /closed/, "the old token is refused");
  const sessionsFile = path.join(home, ".config/pi-outpost/sessions.json");
  const leftBehind = await fs.readFile(sessionsFile, "utf8").then((text) => JSON.parse(text).sessions.length, () => 0);
  assert.equal(leftBehind, 0, "the deployment check left no browser session behind");
  console.log("PASS HttpsCutoverWithPreviousConfiguration");
  await fs.writeFile(path.join(repo, ".local/native-deploy-proof.json"), JSON.stringify({ result: "passed", checks: [
    "exact saved session restored", "real systemd restart", "immutable custom release selected", "authenticated mobile browser and model search", "CLI bridge installed", "ingress unlocked", "browser failure triggers rollback without reverting a newer user session selection", "HTTPS cutover with tls init, token rotate and --previous-config",
  ] }, null, 2));
  console.log("PASS RealNativeDeploymentAndFreshSessionIdentity");
} finally {
  client?.close();
  unlockIngress(port);
  try { systemctl("stop", service); } catch {}
  await fs.rm(unit, { force: true });
  await fs.rm(dropInDir, { recursive: true, force: true });
  systemctl("daemon-reload");
  for (const release of releases) await fs.rm(release, { recursive: true, force: true });
  if (previousResult) await fs.writeFile(resultPath, previousResult, { mode: 0o600 });
  else await fs.rm(resultPath, { force: true });
  await fs.rm(root, { recursive: true, force: true });
}
