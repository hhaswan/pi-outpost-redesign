import { readdir, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Running Pi CLI processes that could still be writing a session of `cwd`.
 *
 * Pi does not keep its session file open between appends, so an open-file scan proves
 * nothing. Instead a CLI is identified by its process title (`pi`) or the coding-agent
 * entry in its command line, and counts when it runs in the session's directory or names
 * the file. Linux only: elsewhere the caller must refuse rather than guess.
 */
export async function runningPiCliProcesses(cwd: string, sessionFile: string): Promise<number[]> {
  if (process.platform !== "linux") throw new Error("Detecting a running Pi CLI is supported on Linux only");
  const target = await realpath(cwd);
  const found: number[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let argv: string[];
    try { argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").map((arg) => arg.trim()).filter(Boolean); } catch { continue; }
    if (!argv.length) continue;
    const isPi = path.basename(argv[0]) === "pi" || argv.some((arg) => /pi-coding-agent[\\/]dist[\\/](cli|main)\.js$/.test(arg) || /[\\/]bin[\\/]pi$/.test(arg));
    if (!isPi) continue;
    if (argv.includes(sessionFile)) { found.push(pid); continue; }
    try {
      if (await realpath(await readlink(`/proc/${pid}/cwd`)) === target) found.push(pid);
    } catch {
      // A process we cannot inspect might be the writer: count it.
      found.push(pid);
    }
  }
  return found;
}
