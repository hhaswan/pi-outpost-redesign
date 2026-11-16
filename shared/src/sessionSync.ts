import { readFileSync, statSync } from "node:fs";

/** The SessionManager surface a re-sync needs (extensions see it typed read-only). */
export interface SyncableSessionManager {
  getSessionFile(): string | undefined;
  getEntries(): readonly { id: string }[];
  getLeafId(): string | null;
  setSessionFile(file: string): void;
  branch(id: string): void;
}

const seen = new WeakMap<object, string>();

/**
 * Pick up entries another process (the Pi CLI, or Outpost web) appended to the same
 * session file, so this process's next entry chains after that writer's last one.
 * Returns how many entries arrived; 0 when nothing changed.
 *
 * Every writer appends one line per entry, so more complete non-empty lines than
 * entries held means someone else wrote. Callers must only call this between turns.
 */
export function syncSessionFile(manager: SyncableSessionManager): number {
  const file = manager.getSessionFile();
  const stat = file ? statSync(file, { throwIfNoEntry: false }) : undefined;
  if (!file || !stat) return 0;
  const key = `${stat.size}:${stat.mtimeMs}`;
  if (seen.get(manager) === key) return 0;
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return 0; }
  seen.set(manager, key);
  // An unterminated last line is a write still in progress: count it next time.
  const lines = text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter((line) => line.trim()).length;
  const before = manager.getEntries();
  if (lines <= before.length + 1) return 0; // + the header line
  const leaf = manager.getLeafId();
  const atTip = leaf === (before.at(-1)?.id ?? null);
  manager.setSessionFile(file);
  // A navigation away from the tip (an edit about to be resent) keeps its place.
  if (!atTip && leaf) manager.branch(leaf);
  return manager.getEntries().length - before.length;
}
