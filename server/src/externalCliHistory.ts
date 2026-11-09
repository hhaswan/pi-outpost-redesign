import { constants } from "node:fs";
import { open, readdir, lstat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { SessionSummary } from "@pi-outpost/shared";

const MAX_FILES = 2000;
// CLI sessions often begin with a large system message before the first user prompt.
const PREFIX_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
const MAX_LABEL = 120;

/** Pi's default session directory is per cwd. Outpost's explicit SESSION_DIR is flat. */
export function cliSessionDirectory(agentDir: string, cwd: string): string {
  const safeCwd = `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(agentDir, "sessions", safeCwd);
}

const scans = new Map<string, { at: number; mtimeMs: number; result: Promise<SessionSummary[]> }>();

export async function externalCliHistory(agentDir: string, cwd: string): Promise<SessionSummary[]> {
  const directory = cliSessionDirectory(agentDir, cwd);
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

async function scanDirectory(directory: string, cwd: string): Promise<SessionSummary[]> {
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
  const inspect = async ({ name, stat }: (typeof candidates)[number]): Promise<SessionSummary | null> => {
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
    let header: { type?: string; cwd?: string; id?: unknown };
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
    return { path: file, id: header.id, ...(nameValue ? { name: nameValue } : {}), firstMessage,
      modified: stat.mtime.toISOString(), readOnlyCliHistory: true };
  };
  const summaries: (SessionSummary | null)[] = [];
  const recent = candidates.slice(0, MAX_FILES);
  for (let i = 0; i < recent.length; i += 16) summaries.push(...await Promise.all(recent.slice(i, i + 16).map(inspect)));
  return summaries.filter((summary): summary is SessionSummary => summary !== null);
}
