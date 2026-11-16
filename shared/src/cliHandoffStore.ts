// Node-only: intentionally not exported by the browser shared index.
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, opendir, readlink, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export type CliHandoffReceipt = {
  version: 1; id: string; bridgeId: string; pid: number; cwd: string;
  sessionId: string; sessionFile: string; pidNamespace?: string; owner?: { pid: number; workspace: string };
  /** Created by the server itself for a CLI the operator closed; that server is the releaser. */
  adoption?: "closed-cli";
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 16 * 1024;
const invalid = () => new Error("CLI handoff data is invalid or unsafe");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !v.includes("\0");
const absolute = (v: unknown): v is string => text(v) && path.isAbsolute(v) && path.normalize(v) === v;
const pid = (v: unknown): v is number => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 2147483647;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const directoryPath = (directory?: string) => path.resolve(directory ?? process.env.PI_OUTPOST_HANDOFF_DIR ?? path.join(homedir(), ".pi", "outpost-handoffs"));
const processNamespace = async (): Promise<string | undefined> => process.platform === "linux" ? readlink("/proc/self/ns/pid") : undefined;

function privateStat(stat: Stats, directory: boolean): void {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw invalid();
  if (process.platform !== "win32" && (stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600))) throw invalid();
}

/** Check every ancestor before opening anything through it. */
async function ancestors(target: string): Promise<boolean> {
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat: Stats;
    try { stat = await lstat(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalid();
    if (process.platform !== "win32" &&
        ((stat.uid !== process.getuid?.() && stat.uid !== 0) ||
         ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000))))) throw invalid();
  }
  return true;
}
async function safeDirectory(directory: string, create = false): Promise<boolean> {
  if (!(await ancestors(directory))) {
    if (!create) return false;
    // Create one level at a time, checking existing parents rather than following links.
    const parent = path.dirname(directory);
    if (parent === directory) throw invalid();
    if (!(await ancestors(parent))) await safeDirectory(parent, true);
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!(await ancestors(directory))) throw invalid();
  }
  privateStat(await lstat(directory), true);
  return true;
}
function receipt(value: unknown, id: string): CliHandoffReceipt {
  if (!object(value) || !keys(value, ["version", "id", "bridgeId", "pid", "cwd", "sessionId", "sessionFile", "pidNamespace", "owner", "adoption"]) ||
      value.version !== 1 || !uuid(value.id) || value.id !== id || !uuid(value.bridgeId) || !pid(value.pid) ||
      !absolute(value.cwd) || !uuid(value.sessionId) || !absolute(value.sessionFile) ||
      (value.adoption !== undefined && value.adoption !== "closed-cli") ||
      (value.pidNamespace !== undefined && (typeof value.pidNamespace !== "string" || !/^pid:\[\d+\]$/.test(value.pidNamespace)))) throw invalid();
  if ("owner" in value && (!object(value.owner) || !keys(value.owner, ["pid", "workspace"]) || !pid(value.owner.pid) || !text(value.owner.workspace))) throw invalid();
  return value as CliHandoffReceipt;
}
async function readReceipt<T extends { pidNamespace?: string } = CliHandoffReceipt>(directory: string, id: string, validate: (value: unknown, id: string) => T = receipt as never): Promise<T> {
  if (!uuid(id) || !(await safeDirectory(directory))) throw invalid();
  const file = path.join(directory, `${id}.json`);
  const before = await lstat(file);
  privateStat(before, false);
  if (before.size > MAX) throw invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    privateStat(stat, false);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > MAX) throw invalid();
    const buffer = Buffer.alloc(MAX + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX) throw invalid();
    const value = validate(JSON.parse(buffer.subarray(0, length).toString("utf8")), id);
    // A PID in another container's namespace is not evidence of process death here.
    if (value.pidNamespace !== await processNamespace()) throw invalid();
    return value;
  } finally { await handle.close(); }
}
async function registry<T extends { sessionFile: string; pidNamespace?: string } = CliHandoffReceipt>(directory: string, validate: (value: unknown, id: string) => T = receipt as never): Promise<T[]> {
  if (!(await safeDirectory(directory))) return [];
  const result: T[] = [];
  const dir = await opendir(directory);
  let count = 0;
  for await (const entry of dir) {
    if (++count > 1024) throw invalid();
    const temp = /^\.([0-9a-f-]{36})-([0-9a-f-]{36})\.tmp$/i.exec(entry.name);
    const lock = /^\.([0-9a-f-]{36})\.lock$/i.exec(entry.name);
    if (temp && uuid(temp[1]) && uuid(temp[2])) {
      const stat = await lstat(path.join(directory, entry.name));
      privateStat(stat, false);
      if (stat.size > MAX) throw invalid();
      continue;
    }
    if (lock && uuid(lock[1])) {
      const lockPath = path.join(directory, entry.name);
      privateStat(await lstat(lockPath), true);
      const contents = await opendir(lockPath);
      for await (const unused of contents) { void unused; throw invalid(); }
      continue;
    }
    if (!entry.name.endsWith(".json") || !uuid(entry.name.slice(0, -5))) throw invalid();
    result.push(await readReceipt(directory, entry.name.slice(0, -5), validate));
  }
  if (new Set(result.map((record) => record.sessionFile)).size !== result.length) throw invalid();
  return result;
}
/** Only a closed-CLI adoption may be claimed while its publisher (this server) is alive. */
const selfReleased = (value: CliHandoffReceipt) => value.adoption === "closed-cli" && value.pid === process.pid;
function alive(processId: number): boolean {
  try { process.kill(processId, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw invalid();
  }
}
async function canonicalCwd(cwd: string): Promise<string> {
  if (!text(cwd) || !path.isAbsolute(cwd)) throw invalid();
  const result = await realpath(cwd);
  if (!(await lstat(result)).isDirectory()) throw invalid();
  return result;
}
async function sessionIdentity(value: Pick<CliHandoffReceipt, "cwd" | "sessionFile" | "sessionId">): Promise<string> {
  if (!absolute(value.sessionFile) || !(await ancestors(path.dirname(value.sessionFile)))) throw invalid();
  const before = await lstat(value.sessionFile);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw invalid();
  const file = await realpath(value.sessionFile);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) throw invalid();
    const buffer = Buffer.alloc(MAX + 1);
    let length = 0, end = -1;
    while (length < buffer.length && end < 0) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
      end = buffer.subarray(0, length).indexOf(10);
    }
    if (end < 0) end = length;
    if (end > MAX) throw invalid();
    const header: unknown = JSON.parse(buffer.subarray(0, end).toString("utf8").replace(/\r$/, ""));
    if (!object(header) || header.type !== "session" || header.id !== value.sessionId || header.cwd !== value.cwd) throw invalid();
    return file;
  } finally { await handle.close(); }
}
async function publish(directory: string, value: { id: string }): Promise<void> {
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > MAX) throw invalid();
  const temp = path.join(directory, `.${value.id}-${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temp);
    throw error;
  }
  await handle.close();
  try { await rename(temp, path.join(directory, `${value.id}.json`)); }
  finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  // Windows cannot open directories for fsync. On POSIX make the rename durable too.
  if (process.platform !== "win32") {
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  }
}
export async function createCliHandoff(input: { bridgeId: string; cwd: string; sessionId: string; sessionFile: string }, directory?: string, adoption?: "closed-cli"): Promise<CliHandoffReceipt> {
  if (!object(input) || !keys(input, ["bridgeId", "cwd", "sessionId", "sessionFile"])) throw invalid();
  const cwd = await canonicalCwd(input.cwd);
  const id = randomUUID();
  const value = receipt({ ...input, cwd, id, version: 1, pid: process.pid, pidNamespace: await processNamespace(), ...(adoption ? { adoption } : {}) }, id);
  value.sessionFile = await sessionIdentity(value);
  const dir = directoryPath(directory);
  await safeDirectory(dir, true);
  const records = await registry(dir);
  if (records.some(r => r.sessionFile === value.sessionFile)) throw invalid();
  await publish(dir, value);
  return value;
}

export async function listCliHandoffs(cwd: string, directory?: string): Promise<Array<{ id: string; cwd: string; sessionId: string; state: "releasing" | "ready" | "owned" }>> {
  const target = await canonicalCwd(cwd);
  return (await registry(directoryPath(directory))).filter(r => r.cwd === target).map(r => ({
    id: r.id, cwd: r.cwd, sessionId: r.sessionId, state: alive(r.pid) && !selfReleased(r) ? "releasing" : r.owner ? "owned" : "ready",
  }));
}
export async function claimCliHandoff(id: string, cwd: string, workspace: string, directory?: string): Promise<CliHandoffReceipt> {
  if (!uuid(id) || !text(workspace)) throw invalid();
  const target = await canonicalCwd(cwd), dir = directoryPath(directory);
  await registry(dir);
  if (!(await safeDirectory(dir))) throw invalid();
  const lock = path.join(dir, `.${id}.lock`);
  await mkdir(lock, { mode: 0o700 }); // Never steal a mutex, even after a crash.
  try {
    privateStat(await lstat(lock), true);
    const value = await readReceipt(dir, id);
    // A receipt this server created for a closed CLI names itself as releaser.
    if (value.cwd !== target || (alive(value.pid) && !selfReleased(value))) throw invalid();
    if (await sessionIdentity(value) !== value.sessionFile) throw invalid();
    if (value.owner && alive(value.owner.pid) && (value.owner.pid !== process.pid || value.owner.workspace !== workspace)) throw invalid();
    value.owner = { pid: process.pid, workspace };
    await publish(dir, value);
    return value;
  } finally { await rmdir(lock); }
}
export async function adoptedCliHandoffs(cwd: string, directory?: string): Promise<CliHandoffReceipt[]> {
  const target = await canonicalCwd(cwd);
  return (await registry(directoryPath(directory))).filter(r => r.cwd === target && r.owner !== undefined);
}
async function canonicalTarget(file: string): Promise<string> {
  if (!text(file)) throw invalid();
  const target = path.resolve(file);
  try { return await realpath(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(target);
    if (parent === target) throw invalid();
    return path.join(await canonicalTarget(parent), path.basename(target));
  }
}
export async function findCliHandoff(sessionFile: string, cwd: string, directory?: string): Promise<CliHandoffReceipt | undefined> {
  const records = await registry(directoryPath(directory));
  const target = await canonicalTarget(sessionFile), root = await canonicalCwd(cwd);
  const matches = records.filter(r => r.cwd === root && r.sessionFile === target);
  if (matches.length > 1) throw invalid();
  return matches[0];
}
export async function assertCliHandoffNotReserved(sessionFile: string | undefined, directory?: string): Promise<void> {
  const records = await registry(directoryPath(directory));
  if (sessionFile === undefined) return;
  const target = await canonicalTarget(sessionFile);
  if (records.some(r => r.sessionFile === target && (r.pid !== process.pid || r.owner !== undefined))) throw new Error("CLI session is reserved by an Outpost handoff");
}

/**
 * Adopt a CLI history file whose CLI the operator says is closed. This process is the
 * releaser, so the CLI reservation check refuses any later enrolled CLI on the file.
 */
export async function createClosedCliHandoff(input: { cwd: string; sessionId: string; sessionFile: string }, directory?: string): Promise<CliHandoffReceipt> {
  return createCliHandoff({ ...input, bridgeId: randomUUID() }, directory, "closed-cli");
}

/** Web-to-CLI reservation: the web released this file; one enrolled CLI may claim it. */
export type CliReservation = {
  version: 1; id: string; cwd: string; sessionId: string; sessionFile: string; pidNamespace?: string;
  releasedBy: number; phase: "releasing" | "released"; claimedBy?: number;
};
const reservationDirectory = (directory?: string) => path.resolve(directory ?? process.env.PI_OUTPOST_RESERVATION_DIR ?? path.join(homedir(), ".pi", "outpost-cli-reservations"));
function reservation(value: unknown, id: string): CliReservation {
  if (!object(value) || !keys(value, ["version", "id", "cwd", "sessionId", "sessionFile", "pidNamespace", "releasedBy", "phase", "claimedBy"]) ||
      value.version !== 1 || !uuid(value.id) || value.id !== id || !absolute(value.cwd) || !uuid(value.sessionId) || !absolute(value.sessionFile) ||
      !pid(value.releasedBy) || (value.phase !== "releasing" && value.phase !== "released") || (value.claimedBy !== undefined && !pid(value.claimedBy)) ||
      (value.pidNamespace !== undefined && (typeof value.pidNamespace !== "string" || !/^pid:\[\d+\]$/.test(value.pidNamespace)))) throw invalid();
  return value as CliReservation;
}
async function withReservationLock<T>(dir: string, id: string, action: (value: CliReservation) => Promise<T>): Promise<T> {
  if (!uuid(id) || !(await safeDirectory(dir))) throw invalid();
  const lock = path.join(dir, `.${id}.lock`);
  await mkdir(lock, { mode: 0o700 }); // Never steal a mutex, even after a crash.
  try {
    privateStat(await lstat(lock), true);
    return await action(await readReceipt(dir, id, reservation));
  } finally { await rmdir(lock); }
}
export type CliReservationState = "releasing" | "waiting" | "claimed" | "stale";
export function cliReservationState(value: CliReservation): CliReservationState {
  if (value.claimedBy !== undefined) return alive(value.claimedBy) ? "claimed" : "stale";
  if (value.phase === "releasing") return alive(value.releasedBy) ? "releasing" : "stale";
  return "waiting";
}
export async function listCliReservations(cwd: string, directory?: string): Promise<Array<CliReservation & { state: CliReservationState }>> {
  const target = await canonicalCwd(cwd);
  return (await registry(reservationDirectory(directory), reservation)).filter(r => r.cwd === target).map(r => ({ ...r, state: cliReservationState(r) }));
}
export async function findCliReservation(sessionFile: string, directory?: string): Promise<CliReservation | undefined> {
  const target = await canonicalTarget(sessionFile);
  return (await registry(reservationDirectory(directory), reservation)).find(r => r.sessionFile === target);
}
/** Phase one: before the web runtime leaves the file, so nothing else can open it meanwhile. */
export async function reserveForCli(input: { cwd: string; sessionId: string; sessionFile: string }, directory?: string, handoffDirectory?: string): Promise<CliReservation> {
  const cwd = await canonicalCwd(input.cwd);
  const id = randomUUID();
  const value = reservation({ ...input, cwd, id, version: 1, releasedBy: process.pid, phase: "releasing", pidNamespace: await processNamespace() }, id);
  value.sessionFile = await sessionIdentity(value);
  const dir = reservationDirectory(directory);
  await safeDirectory(dir, true);
  const existing = (await registry(dir, reservation)).find(r => r.sessionFile === value.sessionFile);
  if (existing && cliReservationState(existing) !== "stale") throw invalid();
  if (existing) await unlink(path.join(dir, `${existing.id}.json`));
  // Handoff receipts and reservations must never describe the same file at once.
  // An adopted file this server owns may move on to a CLI; its receipt is dropped once released.
  if ((await registry(directoryPath(handoffDirectory))).some(r => r.sessionFile === value.sessionFile && r.owner?.pid !== process.pid)) throw invalid();
  await publish(dir, value);
  return value;
}
/** Phase two: the web runtime no longer holds the file. */
export async function markCliReservationReleased(id: string, directory?: string): Promise<CliReservation> {
  const dir = reservationDirectory(directory);
  return withReservationLock(dir, id, async (value) => {
    if (value.releasedBy !== process.pid || value.phase !== "releasing") throw invalid();
    value.phase = "released";
    await publish(dir, value);
    return value;
  });
}
/** Take an unclaimed (or dead-claimed) reservation back for the web. */
export async function cancelCliReservation(id: string, directory?: string): Promise<void> {
  const dir = reservationDirectory(directory);
  await withReservationLock(dir, id, async (value) => {
    if (cliReservationState(value) === "claimed" || (value.phase === "releasing" && value.releasedBy !== process.pid && alive(value.releasedBy))) throw invalid();
    await unlink(path.join(dir, `${value.id}.json`));
  });
}
/**
 * Web side: may this file be opened by a web runtime? A reservation whose claiming CLI
 * exited is finished and removed; any other reservation blocks.
 */
export async function assertWebMayOpen(sessionFile: string, directory?: string): Promise<void> {
  const value = await findCliReservation(sessionFile, directory);
  if (!value) return;
  if (cliReservationState(value) !== "stale") throw new Error(value.claimedBy !== undefined
    ? "This session was handed off to a CLI that is still running. Exit that CLI (or hand it back with /outpost-bridge handoff) first."
    : "This session was handed off to the CLI. Open it there, or take it back from Terminal sessions.");
  await cancelCliReservation(value.id, directory);
}
/** CLI side: claim a released reservation for this process, or refuse. No reservation is a no-op. */
export async function claimCliReservation(sessionFile: string | undefined, directory?: string): Promise<boolean> {
  if (sessionFile === undefined) return false;
  const found = await findCliReservation(sessionFile, directory);
  if (!found) return false;
  const dir = reservationDirectory(directory);
  return withReservationLock(dir, found.id, async (value) => {
    if (value.claimedBy === process.pid) return true;
    const state = cliReservationState(value);
    if (state === "claimed" || state === "releasing" || (state === "stale" && value.claimedBy === undefined)) throw new Error("CLI reservation is not available");
    value.claimedBy = process.pid;
    await publish(dir, value);
    return true;
  });
}
/** CLI side, before switching: would the claim succeed? */
export async function assertCliReservationClaimable(sessionFile: string | undefined, directory?: string): Promise<void> {
  if (sessionFile === undefined) return;
  const value = await findCliReservation(sessionFile, directory);
  if (!value || value.claimedBy === process.pid) return;
  const state = cliReservationState(value);
  if (state === "claimed" || state === "releasing" || (state === "stale" && value.claimedBy === undefined)) throw new Error("CLI reservation is not available");
}

/** Remove the handoff receipt of a file this server owned, after releasing it to a CLI. */
export async function dropOwnedCliHandoff(sessionFile: string, directory?: string): Promise<void> {
  const dir = directoryPath(directory);
  const target = await canonicalTarget(sessionFile);
  const found = (await registry(dir)).find(r => r.sessionFile === target);
  if (!found) return;
  const lock = path.join(dir, `.${found.id}.lock`);
  await mkdir(lock, { mode: 0o700 });
  try {
    privateStat(await lstat(lock), true);
    const value = await readReceipt(dir, found.id);
    if (value.owner?.pid !== process.pid) throw invalid();
    await unlink(path.join(dir, `${value.id}.json`));
  } finally { await rmdir(lock); }
}
