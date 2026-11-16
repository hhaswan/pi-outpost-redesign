import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  assertCliHandoffNotReserved, assertCliReservationClaimable, assertWebMayOpen, cancelCliReservation, claimCliHandoff,
  claimCliReservation, createCliHandoff, createClosedCliHandoff, listCliHandoffs, listCliReservations, markCliReservationReleased, reserveForCli,
} from "../../shared/src/cliHandoffStore.ts";

const moduleUrl = new URL("../../shared/src/cliHandoffStore.ts", import.meta.url).href;
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cli-reservation-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "reservations"), handoffs = path.join(root, "handoffs"), sessionFile = path.join(root, "session.jsonl");
  const input = { cwd: root, sessionId: randomUUID(), sessionFile };
  const source = JSON.stringify({ type: "session", version: 3, id: input.sessionId, cwd: root }) + "\n";
  await writeFile(sessionFile, source);
  return { root, directory, handoffs, sessionFile, input, source };
}
/** A real CLI-like process that claims and holds the reservation until told to exit. */
async function cli(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  const proc = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import * as store from ${JSON.stringify(moduleUrl)}; try { await store.claimCliReservation(${JSON.stringify(f.sessionFile)}, ${JSON.stringify(f.directory)}); process.send('claimed'); } catch { process.send('refused'); } process.once('message', () => process.exit(0));`],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = new Promise<void>(resolve => proc.once("exit", () => resolve()));
  t.after(async () => { if (proc.exitCode === null) proc.kill(); await exited; });
  const outcome = await new Promise<string>(resolve => proc.once("message", m => resolve(String(m))));
  return { outcome, pid: proc.pid!, async stop() { proc.send("exit"); await exited; } };
}

test("WebReleasedSessionWaitsForOneCli: web is refused until the claiming CLI exits; a second CLI is refused", async t => {
  const f = await fixture(t);
  const reserved = await reserveForCli(f.input, f.directory, f.handoffs);
  await assert.rejects(assertCliReservationClaimable(f.sessionFile, f.directory), "not claimable before the web runtime has left");
  await assert.rejects(assertWebMayOpen(f.sessionFile, f.directory));
  await markCliReservationReleased(reserved.id, f.directory);
  assert.equal((await listCliReservations(f.root, f.directory))[0].state, "waiting");
  await assert.rejects(assertWebMayOpen(f.sessionFile, f.directory), /handed off to the CLI/);
  const first = await cli(t, f);
  assert.equal(first.outcome, "claimed");
  assert.equal((await listCliReservations(f.root, f.directory))[0].state, "claimed");
  const second = await cli(t, f);
  assert.equal(second.outcome, "refused");
  await assert.rejects(cancelCliReservation(reserved.id, f.directory), "web cannot take back a file a live CLI holds");
  await assert.rejects(assertWebMayOpen(f.sessionFile, f.directory), /still running/);
  await first.stop();
  await assertWebMayOpen(f.sessionFile, f.directory);
  assert.deepEqual(await listCliReservations(f.root, f.directory), [], "finished reservation is removed");
  assert.equal(await readFile(f.sessionFile, "utf8"), f.source);
});

test("UnclaimedReservationCanBeTakenBack: web reclaims before any CLI starts", async t => {
  const f = await fixture(t);
  const reserved = await reserveForCli(f.input, f.directory, f.handoffs);
  await markCliReservationReleased(reserved.id, f.directory);
  await assert.rejects(reserveForCli(f.input, f.directory, f.handoffs), "one reservation per file");
  await cancelCliReservation(reserved.id, f.directory);
  await assertWebMayOpen(f.sessionFile, f.directory);
  await assert.doesNotReject(assertCliReservationClaimable(f.sessionFile, f.directory));
  assert.equal(await claimCliReservation(f.sessionFile, f.directory), false, "no reservation is a no-op for an unrelated CLI start");
});

test("ClosedCliAdoptionByServer: the server may claim its own receipt; a CLI is then refused", async t => {
  const f = await fixture(t);
  const receipt = await createClosedCliHandoff(f.input, f.handoffs);
  assert.equal((await listCliHandoffs(f.root, f.handoffs))[0].state, "ready", "own receipt is not shown as releasing");
  await assert.rejects(claimCliHandoff(receipt.id, path.join(f.root, ".."), "main", f.handoffs), "cwd still checked");
  const owned = await claimCliHandoff(receipt.id, f.root, "main", f.handoffs);
  assert.deepEqual(owned.owner, { pid: process.pid, workspace: "main" });
  const proc = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import * as store from ${JSON.stringify(moduleUrl)}; await store.assertCliHandoffNotReserved(${JSON.stringify(f.sessionFile)}, ${JSON.stringify(f.handoffs)});`], { stdio: "ignore" });
  const code = await new Promise<number | null>(resolve => proc.once("exit", resolve));
  assert.notEqual(code, 0, "a CLI process must refuse the adopted file");
  await assert.rejects(assertCliHandoffNotReserved(f.sessionFile, f.handoffs), "an owned receipt reserves the file for its web owner");
  // The owning server may move its adopted file on to a CLI; another process's receipt still blocks.
  await assert.doesNotReject(reserveForCli(f.input, f.directory, f.handoffs));
  const other = await fixture(t);
  await createCliHandoff({ ...other.input, bridgeId: randomUUID() }, other.handoffs);
  await assert.rejects(reserveForCli(other.input, other.directory, other.handoffs), "an unowned receipt blocks a reservation");
});
