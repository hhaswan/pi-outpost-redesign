import { constants } from "node:fs";
import { open, readdir, lstat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { MIN_SESSION_QUERY_LENGTH, type SessionSummary } from "@pi-outpost/shared";
import { snippetAround } from "./sessions.ts";

const MAX_FILES = 2000;
// CLI sessions often begin with a large system message before the first user prompt.
const PREFIX_BYTES = 256 * 1024;
// Keep reading the head past PREFIX_BYTES, while no user prompt was found, up to this budget.
const HEAD_BUDGET = 1024 * 1024;
// Longer head lines (a sub-agent's system message) are skipped without decoding.
const MAX_LINE = 256 * 1024;
const CHUNK_BYTES = 64 * 1024;
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
/** `name` is the latest session_info in the whole file: null when none or cleared. */
type Detail = { key: string; messageCount: number; text: string; name: string | null };
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
  let name: string | null = null;
  // Counted like SessionManager.list: every message entry; text from user and assistant ones.
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('"session_info"')) {
      const info = sessionInfo(line);
      if (info) name = info.name ?? null;
      continue;
    }
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
  details.set(file, { key, messageCount, text: parts.join(" "), name });
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
    return detail ? withDetail(file.summary, detail) : file.summary;
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
    return [{ ...(detail ? withDetail(summary, detail) : summary), ...(snippet ? { snippet } : {}) }];
  });
}

/** The full read knows the latest title even when it sits between the head and tail windows. */
function withDetail(summary: SessionSummary, detail: Detail): SessionSummary {
  const { name: _name, ...rest } = summary;
  return { ...rest, ...(detail.name ? { name: detail.name } : {}), messageCount: detail.messageCount };
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

/** A session_info entry: `name` undefined when cleared. Null when the line is not one. */
function sessionInfo(line: string): { name?: string } | null {
  let entry: { type?: string; name?: unknown };
  try { entry = JSON.parse(line); } catch { return null; }
  if (entry?.type !== "session_info") return null;
  const name = typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_LABEL) : "";
  return name ? { name } : {};
}

/** The latest session_info in `lines`, or null when there is none. */
function latestInfo(lines: string[]): { name?: string } | null {
  let latest: { name?: string } | null = null;
  for (const line of lines) if (line.includes('"session_info"')) latest = sessionInfo(line) ?? latest;
  return latest;
}

/**
 * Streams complete lines from the start of the file, at most HEAD_BUDGET bytes. Lines longer
 * than MAX_LINE are skipped undecoded. `onLine` gets each line and the offset after it, and
 * returns true to stop. Resolves to whether the whole file was read.
 */
async function readHead(handle: FileHandle, size: number, onLine: (line: string, end: number) => boolean): Promise<boolean> {
  let position = 0;
  let parts: Buffer[] = [];
  let partLength = 0;
  let skipping = false;
  const limit = Math.min(size, HEAD_BUDGET);
  while (position < limit) {
    const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, limit - position));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
    if (bytesRead === 0) break;
    const data = chunk.subarray(0, bytesRead);
    let from = 0;
    for (let newline = data.indexOf(10); newline !== -1; newline = data.indexOf(10, from)) {
      if (!skipping) {
        parts.push(data.subarray(from, newline));
        if (onLine(Buffer.concat(parts).toString("utf8").replace(/\r$/, ""), position + newline + 1)) return false;
      }
      parts = []; partLength = 0; skipping = false; from = newline + 1;
    }
    position += bytesRead;
    if (!skipping && from < bytesRead) {
      parts.push(data.subarray(from));
      partLength += bytesRead - from;
      if (partLength > MAX_LINE) { skipping = true; parts = []; partLength = 0; }
    }
  }
  if (position < size) return false;
  if (!skipping && partLength > 0) onLine(Buffer.concat(parts).toString("utf8").replace(/\r$/, ""), position);
  return true;
}

function messageText(content: unknown): string {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter((part): part is { type: "text"; text: string } =>
      !!part && typeof part === "object" && part.type === "text" && typeof part.text === "string").map(part => part.text).join(" ")
    : "";
  return text.trim().slice(0, MAX_LABEL);
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
    let header: { type?: string; cwd?: string; id?: unknown; parentSession?: unknown } | undefined;
    let firstMessage = "";
    let headInfo: { name?: string } | null = null;
    let tailInfo: { name?: string } | null = null;
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1 || current.dev !== stat.dev || current.ino !== stat.ino) return null;
      const size = Number(current.size);
      const whole = await readHead(handle, size, (line, end) => {
        if (!header) {
          try { header = JSON.parse(line); } catch { header = {}; }
          return header!.type !== "session";
        }
        if (line.includes('"session_info"')) headInfo = sessionInfo(line) ?? headInfo;
        else if (!firstMessage && line.includes('"user"')) {
          let entry: { type?: string; message?: { role?: string; content?: unknown } };
          try { entry = JSON.parse(line); } catch { return false; }
          if (entry?.type === "message" && entry.message?.role === "user") firstMessage = messageText(entry.message.content);
        }
        return !!firstMessage && end >= PREFIX_BYTES;
      });
      // Only the tail can prove the latest title of a long file: a rename or explicit clear.
      if (!whole) {
        const start = Math.max(0, size - TAIL_BYTES);
        tailInfo = latestInfo(completeLines(await readWindow(handle, start, size - start), start === 0, true));
      }
    } catch { return null; }
    finally { await handle.close(); }
    const valid = header as { type?: string; cwd?: string; id?: unknown; parentSession?: unknown } | undefined;
    if (valid?.type !== "session" || valid.cwd !== cwd || typeof valid.id !== "string" || valid.id.length > 128) return null;
    const nameValue = ((tailInfo ?? headInfo) as { name?: string } | null)?.name;
    return { key: `${Number(stat.size)}:${Number(stat.mtimeMs)}`, summary: { path: file, id: valid.id, ...(nameValue ? { name: nameValue } : {}), firstMessage,
      ...(typeof valid.parentSession === "string" ? { parentSession: path.resolve(valid.parentSession) } : {}),
      modified: stat.mtime.toISOString() } };
  };
  const summaries: (Scanned | null)[] = [];
  const recent = candidates.slice(0, MAX_FILES);
  for (let i = 0; i < recent.length; i += 16) summaries.push(...await Promise.all(recent.slice(i, i + 16).map(inspect)));
  return summaries.filter((summary): summary is Scanned => summary !== null);
}
