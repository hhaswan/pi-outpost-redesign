import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { adoptedCliHandoffs, assertCliHandoffNotReserved, claimCliHandoff, createCliHandoff, findCliHandoff, listCliHandoffs, type CliHandoffReceipt } from "../../shared/src/cliHandoffStore.ts";

const moduleUrl = new URL("../../shared/src/cliHandoffStore.ts", import.meta.url).href;
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cli-handoff-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "registry"), sessionFile = path.join(root, "session.jsonl");
  const input = { bridgeId: randomUUID(), cwd: root, sessionId: randomUUID(), sessionFile };
  const source = JSON.stringify({ type: "session", version: 3, id: input.sessionId, cwd: root }) + "\r\n" + JSON.stringify({ type: "message", content: "unchanged" }) + "\r\n";
  await writeFile(sessionFile, source);
  return { root, directory, sessionFile, input, source };
}
async function child(t: TestContext, script: string) {
  const proc = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import * as store from ${JSON.stringify(moduleUrl)}; ${script}`], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  proc.stderr!.on("data", data => { stderr += data; });
  const exited = new Promise<void>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", code => code === 0 ? resolve() : reject(new Error(`child exit ${code}: ${stderr}`)));
  });
  void exited.catch(() => {});
  t.after(async () => { if (proc.exitCode === null) proc.kill(); await exited.catch(() => {}); });
  const value = await new Promise<CliHandoffReceipt>((resolve, reject) => {
    proc.once("message", message => resolve(message as CliHandoffReceipt));
    proc.once("error", reject);
    proc.once("exit", () => reject(new Error(`publisher exited before receipt: ${stderr}`)));
  });
  return { value, async stop() { proc.send("exit"); await exited; } };
}
async function publisher(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  return child(t, `const receipt = await store.createCliHandoff(${JSON.stringify(f.input)}, ${JSON.stringify(f.directory)}); process.send(receipt); process.once('message', () => process.exit(0));`);
}

test("durable receipt releases only after original process death; same JSONL bytes, private metadata, restart discovery", async t => {
  const f = await fixture(t), cli = await publisher(t, f);
  assert.notEqual(cli.value.pid, process.pid);
  assert.deepEqual(await listCliHandoffs(f.root, f.directory), [{ id: cli.value.id, cwd: f.root, sessionId: f.input.sessionId, state: "releasing" }]);
  await assert.rejects(claimCliHandoff(cli.value.id, f.root, "workspace-a", f.directory));
  await assert.rejects(assertCliHandoffNotReserved(f.sessionFile, f.directory));
  assert.deepEqual(await adoptedCliHandoffs(f.root, f.directory), []);
  await cli.stop();
  assert.equal((await listCliHandoffs(f.root, f.directory))[0].state, "ready");
  const owned = await claimCliHandoff(cli.value.id, f.root, "workspace-a", f.directory);
  assert.deepEqual(owned.owner, { pid: process.pid, workspace: "workspace-a" });
  assert.deepEqual(await claimCliHandoff(cli.value.id, f.root, "workspace-a", f.directory), owned);
  await assert.rejects(claimCliHandoff(cli.value.id, f.root, "workspace-b", f.directory));
  assert.deepEqual(await adoptedCliHandoffs(f.root, f.directory), [owned]);
  assert.deepEqual(await findCliHandoff(f.sessionFile, f.root, f.directory), owned);
  const listed = await listCliHandoffs(f.root, f.directory);
  assert.equal(listed[0].state, "owned");
  assert(!JSON.stringify(listed).includes("workspace-a"));
  assert(!JSON.stringify(listed).includes("sessionFile"));
  assert.equal(await readFile(f.sessionFile, "utf8"), f.source);
  if (process.platform !== "win32") {
    assert.equal((await lstat(f.directory)).mode & 0o777, 0o700);
    assert.equal((await lstat(path.join(f.directory, `${owned.id}.json`))).mode & 0o777, 0o600);
  }
});

test("dead prior owner remains discoverable and another process atomically recovers lease", async t => {
  const f = await fixture(t), cli = await publisher(t, f);
  await cli.stop();
  const owner = await child(t, `const receipt = await store.claimCliHandoff(${JSON.stringify(cli.value.id)}, ${JSON.stringify(f.root)}, 'prior-workspace', ${JSON.stringify(f.directory)}); process.send(receipt); process.once('message', () => process.exit(0));`);
  await assert.rejects(claimCliHandoff(cli.value.id, f.root, "next-workspace", f.directory));
  await owner.stop();
  assert.deepEqual(await adoptedCliHandoffs(f.root, f.directory), [owner.value]);
  const recovered = await claimCliHandoff(cli.value.id, f.root, "next-workspace", f.directory);
  assert.equal(recovered.owner?.pid, process.pid);
});

test("concurrent workspace claims have exactly one winner; abandoned mutex is never stolen", async t => {
  const f = await fixture(t), cli = await publisher(t, f);
  await cli.stop();
  const outcomes = await Promise.allSettled(["one", "two"].map(workspace => claimCliHandoff(cli.value.id, f.root, workspace, f.directory)));
  assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
  const lock = path.join(f.directory, `.${cli.value.id}.lock`);
  await mkdir(lock, { mode: 0o700 });
  assert.equal((await listCliHandoffs(f.root, f.directory)).length, 1);
  await assert.rejects(claimCliHandoff(cli.value.id, f.root, "three", f.directory));
  assert((await lstat(lock)).isDirectory());
  await writeFile(path.join(lock, "unexpected"), "");
  await assert.rejects(listCliHandoffs(f.root, f.directory));
});

test("claim refuses cross-cwd and changed session header without modifying receipt or source", async t => {
  const f = await fixture(t), cli = await publisher(t, f);
  await cli.stop();
  const other = path.join(f.root, "other"); await mkdir(other);
  await assert.rejects(claimCliHandoff(cli.value.id, other, "one", f.directory));
  assert.deepEqual(await listCliHandoffs(other, f.directory), []);
  const recordFile = path.join(f.directory, `${cli.value.id}.json`), original = await readFile(recordFile, "utf8");
  for (const header of [{ type: "session", id: randomUUID(), cwd: f.root }, { type: "session", id: f.input.sessionId, cwd: other }]) {
    const changed = JSON.stringify(header) + "\r\n";
    await writeFile(f.sessionFile, changed);
    await assert.rejects(claimCliHandoff(cli.value.id, f.root, "one", f.directory));
    assert.equal(await readFile(f.sessionFile, "utf8"), changed);
    assert.equal(await readFile(recordFile, "utf8"), original);
  }
});

test("creation validates header, bounded metadata, UUIDs and real regular session file", async t => {
  const f = await fixture(t);
  for (const input of [{ ...f.input, bridgeId: "bad" }, { ...f.input, sessionId: randomUUID() }, { ...f.input, sessionFile: f.root }]) await assert.rejects(createCliHandoff(input, f.directory));
  await writeFile(f.sessionFile, "x".repeat(16385));
  await assert.rejects(createCliHandoff(f.input, f.directory));
  await writeFile(f.sessionFile, f.source);
  const own = await createCliHandoff(f.input, f.directory);
  assert.equal(own.pid, process.pid);
  await assertCliHandoffNotReserved(f.sessionFile, f.directory);
  await assert.rejects(claimCliHandoff(own.id, f.root, "one", f.directory));
  await writeFile(path.join(f.directory, `${own.id}.json`), JSON.stringify({ ...own, owner: { pid: process.pid, workspace: "one" } }));
  await assert.rejects(claimCliHandoff(own.id, f.root, "one", f.directory));
  await assert.rejects(assertCliHandoffNotReserved(f.sessionFile, f.directory));
  await assert.rejects(createCliHandoff(f.input, f.directory));
  assert.equal(await readFile(f.sessionFile, "utf8"), f.source);
});

test("malformed registries and receipts fail closed across discovery and reservation checks", async t => {
  const f = await fixture(t), value = await createCliHandoff(f.input, f.directory);
  const record = path.join(f.directory, `${value.id}.json`);
  for (const content of ["{", "x".repeat(16385), JSON.stringify({ ...value, extra: true }), JSON.stringify({ ...value, pid: 0 }), JSON.stringify({ ...value, cwd: "relative" }), JSON.stringify({ ...value, id: randomUUID() }), JSON.stringify({ ...value, owner: { pid: process.pid, workspace: "x", extra: true } })]) {
    await writeFile(record, content);
    await assert.rejects(listCliHandoffs(f.root, f.directory));
    await assert.rejects(adoptedCliHandoffs(f.root, f.directory));
    await assert.rejects(findCliHandoff(f.sessionFile, f.root, f.directory));
    await assert.rejects(assertCliHandoffNotReserved(undefined, f.directory));
  }
  await writeFile(record, JSON.stringify(value));
  const unknown = path.join(f.directory, "unknown"); await writeFile(unknown, "");
  await assert.rejects(listCliHandoffs(f.root, f.directory)); await rm(unknown);
  const temp = path.join(f.directory, `.${value.id}-${randomUUID()}.tmp`);
  await writeFile(temp, "", { mode: 0o600 });
  assert.equal((await listCliHandoffs(f.root, f.directory)).length, 1);
  await rm(temp); await mkdir(temp, { mode: 0o700 });
  await assert.rejects(listCliHandoffs(f.root, f.directory));
});

test("unsafe private permissions, receipt hardlinks and symlink ancestors fail closed", async t => {
  const f = await fixture(t), value = await createCliHandoff(f.input, f.directory);
  const record = path.join(f.directory, `${value.id}.json`);
  if (process.platform !== "win32") {
    await chmod(record, 0o644); await assert.rejects(listCliHandoffs(f.root, f.directory));
    await chmod(record, 0o600); await chmod(f.directory, 0o755);
    await assert.rejects(listCliHandoffs(f.root, f.directory)); await chmod(f.directory, 0o700);
    const unsafeParent = path.join(f.root, "unsafe-parent");
    await mkdir(unsafeParent); await chmod(unsafeParent, 0o777);
    await assert.rejects(createCliHandoff(f.input, path.join(unsafeParent, "handoffs")));
    await chmod(unsafeParent, 0o700);
  }
  const hard = path.join(f.root, "hard.json"); await link(record, hard);
  await assert.rejects(listCliHandoffs(f.root, f.directory)); await rm(hard);
  const alias = path.join(f.root, "alias");
  await symlink(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(listCliHandoffs(f.root, alias));
  await assert.rejects(createCliHandoff(f.input, path.join(alias, "nested")));
  const sessionAlias = path.join(f.root, "session-alias");
  await symlink(f.root, sessionAlias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(createCliHandoff({ ...f.input, sessionFile: path.join(sessionAlias, "session.jsonl") }, path.join(f.root, "other-registry")));
  if (process.platform !== "win32") {
    const saved = path.join(f.root, "saved.json");
    await rm(record); await writeFile(saved, JSON.stringify(value), { mode: 0o600 }); await symlink(saved, record);
    await assert.rejects(listCliHandoffs(f.root, f.directory));
    await rm(record); await symlink(saved, f.sessionFile + ".link");
    await assert.rejects(createCliHandoff({ ...f.input, sessionFile: f.sessionFile + ".link" }, path.join(f.root, "another-registry")));
  }
});

test("absent default directory and fresh unpersisted session are harmless; missing reserved file still blocks", async t => {
  const f = await fixture(t), fresh = path.join(f.root, "not-yet-created", "session.jsonl");
  const previous = process.env.PI_OUTPOST_HANDOFF_DIR;
  process.env.PI_OUTPOST_HANDOFF_DIR = f.directory;
  try {
    await assertCliHandoffNotReserved(undefined);
    await assertCliHandoffNotReserved(fresh);
    assert.deepEqual(await listCliHandoffs(f.root), []);
    assert.deepEqual(await adoptedCliHandoffs(f.root), []);
    assert.equal(await findCliHandoff(fresh, f.root), undefined);
    const cli = await publisher(t, f);
    await cli.stop(); await rm(f.sessionFile);
    await assertCliHandoffNotReserved(fresh);
    await assert.rejects(assertCliHandoffNotReserved(f.sessionFile));
    await writeFile(path.join(f.directory, "unexpected"), "");
    await assert.rejects(assertCliHandoffNotReserved(fresh));
    await assert.rejects(assertCliHandoffNotReserved(undefined));
  } finally {
    if (previous === undefined) delete process.env.PI_OUTPOST_HANDOFF_DIR;
    else process.env.PI_OUTPOST_HANDOFF_DIR = previous;
  }
});

test("duplicate file receipts and hardlinked conversation files cannot authorize independent writer leases", async t => {
  const f = await fixture(t);
  const linked = path.join(f.root, "linked-session.jsonl");
  await link(f.sessionFile, linked);
  await assert.rejects(createCliHandoff(f.input, f.directory));
  await rm(linked);
  const receipt = await createCliHandoff(f.input, f.directory);
  const duplicate = { ...receipt, id: randomUUID() };
  await writeFile(path.join(f.directory, `${duplicate.id}.json`), JSON.stringify(duplicate), { mode: 0o600 });
  await assert.rejects(listCliHandoffs(f.root, f.directory));
  await assert.rejects(claimCliHandoff(receipt.id, f.root, "one", f.directory));
  assert.equal(await readFile(f.sessionFile, "utf8"), f.source);
});


test("explicit recovery removes only an empty abandoned mutex after its original publisher has exited", async t => {
  const f = await fixture(t), cli = await publisher(t, f);
  await cli.stop();
  assert.throws(() => process.kill(cli.value.pid, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH");
  const mutex = path.join(f.directory, `.${cli.value.id}.lock`);
  await mkdir(mutex, { mode: 0o700 });
  await assert.rejects(claimCliHandoff(cli.value.id, f.root, "recovery", f.directory));
  // The fixture has no other server owner. Production operators must stop every server first.
  await rmdir(mutex);
  const resumed = await claimCliHandoff(cli.value.id, f.root, "recovery", f.directory);
  assert.equal(resumed.owner?.workspace, "recovery");
  assert.equal(await readFile(f.sessionFile, "utf8"), f.source);
});

test("a PID from another namespace never proves that the original CLI exited", async t => {
  const f = await fixture(t), cli = await publisher(t, f);
  await cli.stop();
  const record = path.join(f.directory, `${cli.value.id}.json`);
  await writeFile(record, JSON.stringify({ ...cli.value, pidNamespace: "pid:[0]" }));
  await assert.rejects(listCliHandoffs(f.root, f.directory));
  await assert.rejects(claimCliHandoff(cli.value.id, f.root, "web", f.directory));
  assert.equal(await readFile(f.sessionFile, "utf8"), f.source);
});
