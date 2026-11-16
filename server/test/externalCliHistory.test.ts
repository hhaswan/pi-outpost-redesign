import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cliSessionDirectory, externalCliHistory, forgetCliHistory, searchCliHistory } from "../src/externalCliHistory.ts";

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
    count: sessions[0].messageCount, path: sessions[0].path },
    { id: "valid-id", name: "Earlier CLI conversation", firstMessage: "Old CLI question", count: undefined, path: session });
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

// openlore: scenario=CliHistoryDetailsAreCached spec=session-search
test("CliHistoryDetailsAreCached: count and transcript text are read once per file version, then reused", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project"), directory = cliSessionDirectory(root, cwd);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "s.jsonl");
  const message = (role: string, text: string) => line({ type: "message", message: { role, content: [{ type: "text", text }] } });
  const head = line({ type: "session", id: "s", cwd }) + message("user", "opening question");
  const when = new Date("2026-01-01T00:00:00Z");
  await writeFile(file, head + message("assistant", "the word is aardvark"));
  await utimes(file, when, when);
  assert.equal((await externalCliHistory(root, cwd))[0]?.messageCount, undefined, "the list does not wait for the full read");
  const hit = await searchCliHistory(root, cwd, "aardvark");
  assert.equal(hit[0]?.path, file, "the transcript, not only the opening message, is searched");
  assert.match(hit[0]?.snippet ?? "", /aardvark/);
  assert.equal((await externalCliHistory(root, cwd))[0]?.messageCount, 2);

  // Same size and mtime: the cached version is used, the file is not read again.
  await writeFile(file, head + message("assistant", "the word is platypus"));
  await utimes(file, when, when);
  forgetCliHistory(root, cwd);
  assert.equal((await searchCliHistory(root, cwd, "aardvark"))[0]?.path, file);
  assert.deepEqual(await searchCliHistory(root, cwd, "platypus"), []);

  // Any change of size or mtime is a new version.
  await writeFile(file, head + message("assistant", "the word is platypus") + message("user", "and more"));
  forgetCliHistory(root, cwd);
  assert.equal((await searchCliHistory(root, cwd, "platypus"))[0]?.messageCount, 3);
  assert.deepEqual(await searchCliHistory(root, cwd, "aardvark"), []);
  assert.equal((await externalCliHistory(root, cwd))[0]?.messageCount, 3);
});

test("Sub-agent child sessions keep their early name and the prompt after a huge system message", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project"), directory = cliSessionDirectory(root, cwd);
  await mkdir(directory, { recursive: true });
  const parent = path.join(directory, "parent.jsonl");
  const prompt = `Repo ${cwd}. Fix the sessions list.`;
  const child = path.join(directory, "child.jsonl");
  // Shaped like a real sub-agent file: the system line alone exceeds the 256 KB head window.
  await writeFile(child, line({ type: "session", version: 3, id: "child", cwd, parentSession: parent }) +
    line({ type: "model_change", provider: "anthropic", modelId: "m" }) +
    line({ type: "thinking_level_change", thinkingLevel: "medium" }) +
    line({ type: "session_info", name: "general-purpose#57816f08" }) +
    line({ type: "message", message: { role: "system", content: "", sections: { preamble: "y".repeat(300_000) } } }) +
    line({ type: "message", message: { role: "user", content: [{ type: "text", text: prompt }] } }) +
    line({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "z".repeat(200_000) }] } }));
  const [session] = await externalCliHistory(root, cwd);
  assert.deepEqual(session && { id: session.id, name: session.name, firstMessage: session.firstMessage, parent: session.parentSession },
    { id: "child", name: "general-purpose#57816f08", firstMessage: prompt, parent });
  const [found] = await searchCliHistory(root, cwd, "general-purpose");
  assert.equal(found?.name, "general-purpose#57816f08");
});

test("Background full read supplies a title renamed between the head and tail windows", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cli-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project"), directory = cliSessionDirectory(root, cwd);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "middle.jsonl"), line({ type: "session", id: "middle", cwd }) +
    line({ type: "session_info", name: "Old title" }) +
    line({ type: "message", message: { role: "user", content: "Question" } }) +
    line({ type: "custom", data: "x".repeat(300_000) }) + line({ type: "session_info", name: "Middle title" }) +
    line({ type: "custom", data: "x".repeat(100_000) }));
  await searchCliHistory(root, cwd, "question");
  const [session] = await externalCliHistory(root, cwd);
  assert.equal(session?.name, "Middle title");
  assert.equal(session?.firstMessage, "Question");
});
