import { constants } from "node:fs";
import { open, readdir, lstat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { MIN_SESSION_QUERY_LENGTH, type SessionSummary } from "@pi-outpost/shared";
import { snippetAround } from "./sessions.ts";

const MAX_FILES = 2000;
// CLI sessions often begin with a large system message before the first user prompt.
const PREFIX_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
const MAX_LABEL = 120;

/** Pi's default session directory is per cwd; Outpost writes its sessions there too. */
export function cliSessionDirectory(agentDir: string, cwd: string): string {
  const safeCwd = `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(agentDir, "sessions", safeCwd);
}

/** A listed file and the size:mtime its summary was read at. */
type Scanned = { summary: SessionSummary; key: string };
const scans = new Map<string, { at: number; mtimeMs: number; result: Promise<Scanned[]> }>();

async function scanned(directory: string, cwd: string): Promise<Scanned[]> {
  const stat = await lstat(directory).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return [];
  const cached = scans.get(directory);
  if (cached && Date.now() - cached.at < 3000 && cached.mtimeMs === stat.mtimeMs) return cached.result;
  const result = scanDirectory(directory, path.resolve(cwd));
  scans.set(directory, { at: Date.now(), mtimeMs: stat.mtimeMs, result });
  if (scans.size > 64) scans.delete(scans.keys().next().value!);
  void result.catch(() => scans.delete(directory));
  return result;
}

/**
 * What the cheap scan leaves out — message count and transcript text — read in full
 * once per file version, in the background, and kept for the next list or search.
 * LRU-bounded; the text is capped, so 2000 entries stay a few tens of megabytes.
 */
const MAX_DETAILS = 2000;
const MAX_TEXT = 16 * 1024;
type Detail = { key: string; messageCount: number; text: string };
const details = new Map<string, Detail>();
const warming = new Map<string, Promise<void>>();

function detailOf({ summary, key }: Scanned): Detail | undefined {
  const detail = details.get(summary.path);
  if (detail?.key !== key) return undefined;
  details.delete(summary.path);
  details.set(summary.path, detail);
  return detail;
}

async function readDetail(file: string): Promise<void> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (!handle) return;
  let text: string;
  let key: string;
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.nlink !== 1) return;
    key = `${current.size}:${current.mtimeMs}`;
    text = await handle.readFile("utf8");
  } catch { return; }
  finally { await handle.close(); }
  let messageCount = 0;
  const parts: string[] = [];
  let length = 0;
  // Counted like SessionManager.list: every message entry; text from user and assistant ones.
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"message"')) continue;
    let entry: { type?: string; message?: { role?: string; content?: unknown } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== "message" || !entry.message) continue;
    messageCount++;
    const { role, content } = entry.message;
    if (length >= MAX_TEXT || (role !== "user" && role !== "assistant")) continue;
    const words = typeof content === "string" ? content : Array.isArray(content)
      ? content.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string").map(part => part.text).join(" ")
      : "";
    if (!words) continue;
    parts.push(words.slice(0, MAX_TEXT - length));
    length += words.length + 1;
  }
  details.delete(file);
  details.set(file, { key, messageCount, text: parts.join(" ") });
  if (details.size > MAX_DETAILS) details.delete(details.keys().next().value!);
}

/** One background pass per directory at a time, over the files whose version is not cached. */
function warm(directory: string, files: Scanned[]): Promise<void> {
  const stale = files.filter(file => details.get(file.summary.path)?.key !== file.key);
  if (stale.length === 0) return Promise.resolve();
  const running = warming.get(directory);
  if (running) return running;
  const job = (async () => {
    for (let i = 0; i < stale.length; i += 8) await Promise.all(stale.slice(i, i + 8).map(file => readDetail(file.summary.path)));
  })().catch(() => {}).finally(() => warming.delete(directory));
  warming.set(directory, job);
  return job;
}

export async function externalCliHistory(agentDir: string, cwd: string): Promise<SessionSummary[]> {
  const directory = cliSessionDirectory(agentDir, cwd);
  const files = await scanned(directory, cwd);
  void warm(directory, files);
  return files.map(file => {
    const detail = detailOf(file);
    return detail ? { ...file.summary, messageCount: detail.messageCount } : file.summary;
  });
}

/** Name, first message and transcript, like `searchSessions`; waits for the background read. */
export async function searchCliHistory(agentDir: string, cwd: string, query: string): Promise<SessionSummary[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_SESSION_QUERY_LENGTH) return [];
  const directory = cliSessionDirectory(agentDir, cwd);
  await warm(directory, await scanned(directory, cwd));
  return (await scanned(directory, cwd)).flatMap(file => {
    const detail = detailOf(file);
    const snippet = detail && snippetAround(detail.text, needle);
    const { summary } = file;
    if (!snippet && !summary.name?.toLowerCase().includes(needle) && !summary.firstMessage.toLowerCase().includes(needle)) return [];
    return [{ ...summary, ...(detail ? { messageCount: detail.messageCount } : {}), ...(snippet ? { snippet } : {}) }];
  });
}

/** After a write this server made into the directory (a rename, a title): the cache cannot see it. */
export function forgetCliHistory(agentDir: string, cwd: string): void {
  scans.delete(cliSessionDirectory(agentDir, cwd));
}

async function readWindow(handle: FileHandle, start: number, length: number): Promise<string> {
  const bytes = Buffer.alloc(length);
  const { bytesRead } = await handle.read(bytes, 0, length, start);
  return bytes.subarray(0, bytesRead).toString("utf8");
}

function completeLines(text: string, beginsAtZero: boolean, endsAtEof: boolean): string[] {
  const lines = text.split(/\r?\n/);
  if (!beginsAtZero) lines.shift();
  if (!endsAtEof || !text.endsWith("\n")) lines.pop();
  return lines;
}

function sessionName(lines: string[]): string | undefined {
  let name: string | undefined;
  for (const line of lines) {
    let entry: { type?: string; name?: unknown };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === "session_info") name = typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_LABEL) || undefined : undefined;
  }
  return name;
}

async function scanDirectory(directory: string, cwd: string): Promise<Scanned[]> {
  const rootStat = await lstat(path.dirname(directory)).catch(() => null);
  const dirStat = await lstat(directory).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || !dirStat?.isDirectory() || dirStat.isSymbolicLink()) return [];
  const names = (await readdir(directory).catch(() => [])).filter(name => /^[^/\\]+\.jsonl$/.test(name));
  // Select newest *before* the read limit; directory enumeration order is not chronological.
  const candidates: { name: string; stat: Awaited<ReturnType<typeof lstat>> }[] = [];
  for (let i = 0; i < names.length; i += 64) {
    const batch = await Promise.all(names.slice(i, i + 64).map(async name => {
      const stat = await lstat(path.join(directory, name)).catch(() => null);
      return stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size >= 8 ? { name, stat } : null;
    }));
    candidates.push(...batch.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null));
  }
  candidates.sort((a, b) => Number(b.stat.mtimeMs) - Number(a.stat.mtimeMs));
  const inspect = async ({ name, stat }: (typeof candidates)[number]): Promise<Scanned | null> => {
    const file = path.join(directory, name);
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => null);
    if (!handle) return null;
    let prefix: string;
    let suffix = "";
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1 || current.dev !== stat.dev || current.ino !== stat.ino) return null;
      prefix = await readWindow(handle, 0, Math.min(PREFIX_BYTES, current.size));
      if (current.size > PREFIX_BYTES) {
        const start = Math.max(0, current.size - TAIL_BYTES);
        suffix = await readWindow(handle, start, Math.min(TAIL_BYTES, current.size - start));
      }
    } catch { return null; }
    finally { await handle.close(); }
    const prefixLines = completeLines(prefix, true, stat.size <= PREFIX_BYTES);
    let header: { type?: string; cwd?: string; id?: unknown; parentSession?: unknown };
    try { header = JSON.parse(prefixLines.shift() ?? ""); } catch { return null; }
    if (header.type !== "session" || header.cwd !== cwd || typeof header.id !== "string" || header.id.length > 128) return null;
    let firstMessage = "";
    for (const line of prefixLines) {
      if (firstMessage) break;
      let entry: { type?: string; message?: { role?: string; content?: unknown } };
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== "message" || entry.message?.role !== "user" || !Array.isArray(entry.message.content)) continue;
      firstMessage = entry.message.content.filter((part): part is { type: "text"; text: string } =>
        !!part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
        .map(part => part.text).join(" ").trim().slice(0, MAX_LABEL);
    }
    // Small files have complete metadata. On long files, only the suffix can prove
    // the latest title: an early name may have been changed or explicitly cleared.
    const nameValue = stat.size <= PREFIX_BYTES ? sessionName(prefixLines) : sessionName(completeLines(suffix, false, true));
    return { key: `${Number(stat.size)}:${Number(stat.mtimeMs)}`, summary: { path: file, id: header.id, ...(nameValue ? { name: nameValue } : {}), firstMessage,
      ...(typeof header.parentSession === "string" ? { parentSession: path.resolve(header.parentSession) } : {}),
      modified: stat.mtime.toISOString() } };
  };
  const summaries: (Scanned | null)[] = [];
  const recent = candidates.slice(0, MAX_FILES);
  for (let i = 0; i < recent.length; i += 16) summaries.push(...await Promise.all(recent.slice(i, i + 16).map(inspect)));
  return summaries.filter((summary): summary is Scanned => summary !== null);
}
