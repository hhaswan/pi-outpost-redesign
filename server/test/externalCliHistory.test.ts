import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cliSessionDirectory, externalCliHistory } from "../src/externalCliHistory.ts";

const line = (entry: unknown) => `${JSON.stringify(entry)}\n`;

test("CLI resume history uses per-cwd directory, validates headers, and is read-only", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const directory = cliSessionDirectory(root, cwd);
  assert.equal(directory, path.join(root, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`));
  await mkdir(directory, { recursive: true });
  const session = path.join(directory, "valid.jsonl");
  await writeFile(session, line({ type: "session", version: 3, id: "valid-id", cwd }) +
    line({ type: "message", message: { role: "user", content: [{ type: "text", text: "Old CLI question" }] } }) +
    line({ type: "session_info", name: "Earlier CLI conversation" }));
  await writeFile(path.join(directory, "wrong.jsonl"), line({ type: "session", id: "wrong", cwd: root }));
  await symlink(session, path.join(directory, "link.jsonl"));
  await writeFile(path.join(root, "sessions", "flat.jsonl"), line({ type: "session", id: "flat", cwd }));
  const sessions = await externalCliHistory(root, cwd);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0] && { id: sessions[0].id, name: sessions[0].name, firstMessage: sessions[0].firstMessage,
    readOnly: sessions[0].readOnlyCliHistory, count: sessions[0].messageCount, path: sessions[0].path },
    { id: "valid-id", name: "Earlier CLI conversation", firstMessage: "Old CLI question", readOnly: true, count: undefined, path: session });
});

test("Long CLI history never presents an old title after a rename or explicit clear", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const directory = cliSessionDirectory(root, cwd);
  await mkdir(directory, { recursive: true });
  const beginning = line({ type: "session", id: "long", cwd }) + line({ type: "session_info", name: "Old title" }) +
    line({ type: "message", message: { role: "user", content: [{ type: "text", text: "Original question" }] } });
  await writeFile(path.join(directory, "renamed.jsonl"), beginning + line({ type: "custom", data: "x".repeat(300_000) }) +
    line({ type: "session_info", name: "New title" }));
  await writeFile(path.join(directory, "cleared.jsonl"), beginning.replace('"long"', '"clear"') +
    line({ type: "custom", data: "x".repeat(300_000) }) + line({ type: "session_info", name: "" }));
  const sessions = await externalCliHistory(root, cwd);
  assert.equal(sessions.find(s => s.id === "long")?.name, "New title");
  assert.equal(sessions.find(s => s.id === "clear")?.name, undefined);
  assert.equal(sessions.find(s => s.id === "clear")?.firstMessage, "Original question");
});

test("Directory scan limit selects newest files before the cap", { timeout: 30_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project"), directory = cliSessionDirectory(root, cwd);
  await mkdir(directory, { recursive: true });
  const old = line({ type: "session", cwd, id: "old" });
  for (let i = 0; i < 2000; i++) await writeFile(path.join(directory, `a${i}.jsonl`), old);
  const newest = path.join(directory, "z-newest.jsonl");
  await writeFile(newest, line({ type: "session", cwd, id: "newest" }));
  await utimes(newest, new Date(Date.now() + 30_000), new Date(Date.now() + 30_000));
  const sessions = await externalCliHistory(root, cwd);
  assert.equal(sessions.length, 2000);
  assert.ok(sessions.some(entry => entry.id === "newest"));
});

test("External history rejects symlinked per-project directories and absent directories", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  assert.deepEqual(await externalCliHistory(root, cwd), []);
  await mkdir(path.join(root, "sessions"));
  await symlink(root, cliSessionDirectory(root, cwd));
  assert.deepEqual(await externalCliHistory(root, cwd), []);
});
