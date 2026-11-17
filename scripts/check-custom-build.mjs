#!/usr/bin/env node
/** Verify the distributable, not the source tree, before deploying this fork. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { makeWorkspace, startServer } from "../server/test/harness.mjs";
import { leaveStartScreen } from "./leave-start-screen.mjs";

const entry = path.resolve(process.argv[2] ?? "cli/dist/pi-outpost.mjs");
const root = await makeWorkspace();
const home = path.join(root, "home");
const agentDir = path.join(root, ".pi-agent");
await mkdir(home, { recursive: true });
await mkdir(agentDir, { recursive: true });
let server, browser;
try {
  const calls = path.join(root, "npm-calls.jsonl");
  const fakeNpm = path.join(root, "npm.mjs");
  const config = path.join(root, "update.config.json");
  const packageDir = path.join(agentDir, "npm", "node_modules", "custom-build-fixture");
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: "custom-build-fixture", version: "1.0.0" }));
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:custom-build-fixture"] }));
  await writeFile(config, JSON.stringify({ cwd: root, agentDir, offline: false, updateCheck: true }));
  await writeFile(fakeNpm, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('99.0.0');\n`);
  const update = spawnSync(process.execPath, [entry, "update", "--config", config], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "0", npm_execpath: fakeNpm },
  });
  assert.ifError(update.error);
  assert.equal(update.status, 1);
  assert.match(update.stdout + update.stderr, /custom build; refusing to replace it/);
  const npmCalls = await readFile(calls, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  assert.doesNotMatch(npmCalls, /"(?:view|install)"/, "refusal must not query extension versions either");
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  for (const file of [entry, path.join(path.dirname(entry), "pi-outpost.sea.mjs")]) {
    assert.match(await readFile(file, "utf8"), /var CUSTOM_BUILD = true;/);
  }
  console.log("PASS BuiltCustomUpdateRefusal (npm and SEA markers)");

  const manager = SessionManager.create(root, path.join(agentDir, "sessions"));
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Custom build fixture" }] });
  manager.appendSessionInfo("Custom build regression");
  const common = {
    api: "anthropic-messages", provider: "anthropic", model: "claude-sonnet-4-6",
    timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  manager.appendMessage({ ...common, role: "assistant", stopReason: "toolUse", content: [
    { type: "thinking", thinking: "Custom hidden reasoning" },
    { type: "toolCall", id: "custom-read", name: "read", arguments: { path: "fixture.txt" } },
    { type: "toolCall", id: "custom-bash", name: "bash", arguments: { command: "pwd" } },
  ] });
  for (const [id, name] of [["custom-read", "read"], ["custom-bash", "bash"]]) {
    manager.appendMessage({ role: "toolResult", toolCallId: id, toolName: name,
      content: [{ type: "text", text: "Custom hidden tool output" }], isError: false, timestamp: Date.now() });
  }
  manager.appendMessage({ ...common, role: "assistant", stopReason: "stop",
    content: [{ type: "text", text: "Custom visible answer" }] });

  server = await startServer(root, { sandbox: false, noExtensions: true }, { entry,
    env: { HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
      ANTHROPIC_API_KEY: "fixture-no-model-calls", OPENAI_API_KEY: "fixture-no-model-calls" } });
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.base);
  await leaveStartScreen(page);
  await page.getByRole("button", { name: "sessions", exact: true }).click();
  await page.getByText("Custom build regression", { exact: true }).click();
  await page.getByText("Custom visible answer", { exact: true }).waitFor();
  const group = page.getByRole("button", { name: /Process ·/ });
  assert.equal(await group.count(), 1);
  assert.equal(await group.getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByText("Custom hidden tool output", { exact: true }).count(), 0);
  await group.click();
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  await page.getByText("read", { exact: true }).first().waitFor();
  await group.click();
  await group.dblclick();
  assert.equal(await group.getAttribute("aria-expanded"), "false");
  console.log("PASS BuiltCompactProcess (one collapsed group, expand/collapse, rapid toggles)");

  const trigger = page.getByRole("button", { name: "Model", exact: true });
  await trigger.click();
  const search = page.getByRole("combobox", { name: "Search models" });
  const inventory = await page.getByRole("option").allTextContents();
  assert.ok(inventory.some((label) => label.includes("openai/")));
  await search.fill("NO-SUCH-MODEL-CUSTOM-REGRESSION");
  await page.getByText("No models found.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("option").count(), 0);
  await search.fill("ANTHROPIC");
  const filtered = await page.getByRole("option").allTextContents();
  assert.ok(filtered.length > 0 && filtered.length < inventory.length);
  assert.ok(filtered.every((label) => label.toLowerCase().includes("anthropic/")));
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await trigger.click();
  assert.equal(await search.inputValue(), "");
  assert.deepEqual(await page.getByRole("option").allTextContents(), inventory);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log("PASS BuiltSearchableModels (filter, empty result, case-insensitive, Escape, reopen)");
} finally {
  await browser?.close();
  await server?.stop();
  await rm(root, { recursive: true, force: true });
}
