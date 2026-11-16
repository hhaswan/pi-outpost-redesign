/**
 * "A newer pi-outpost is available" — the standalone app's notice, and nothing more.
 *
 * It never installs: moving the running server is `pi-outpost update`'s job, in a
 * terminal. Dismissing it is remembered per version in this browser — a convenience for
 * this viewer, not state anyone else needs — so the next version is announced again.
 */
import { useState } from "react";
import type { OutpostUpdateNotice } from "@pi-outpost/shared";
import { CopyButton } from "./CopyButton";

const DISMISSED_KEY = "pi-outpost:update-notice-dismissed";

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function UpdateNotice({ notice }: { notice: OutpostUpdateNotice }) {
  const [dismissed, setDismissed] = useState(() => dismissedVersion());
  const [open, setOpen] = useState(false);
  if (dismissed === notice.latest) return null;
  return (
    <div
      role="status"
      data-testid="update-notice"
      className="border-b border-sky-200 bg-sky-50 px-4 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
    >
      {/* One line until asked: the instruction and command are for a terminal, and
          read once — they should not cost the conversation a row on every visit. */}
      <div className="flex items-center gap-2 py-1.5">
        <span className="min-w-0 flex-1 truncate">
          pi-outpost {notice.latest} is available ·{" "}
          <a href={notice.releaseNotes} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
            What's new
          </a>
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded-full px-1.5 font-medium underline-offset-2 hover:underline max-sm:-my-1 max-sm:min-h-11"
        >
          details
        </button>
        <button
          type="button"
          aria-label="Dismiss the update notice"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISSED_KEY, notice.latest);
            } catch {
              // Storage refused: the notice goes for now and comes back next time.
            }
            setDismissed(notice.latest);
          }}
          className="shrink-0 rounded-full px-1.5 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/50 hover:opacity-80 transition-opacity max-sm:-my-1 max-sm:min-h-11 max-sm:min-w-11 max-sm:text-base"
        >
          ×
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          <span className="min-w-0 basis-full sm:basis-auto">You have {notice.running}. {notice.instruction}</span>
          <code className="max-w-full shrink-0 truncate rounded-full bg-white/70 px-1.5 py-0.5 font-mono dark:bg-sky-900/40">{notice.copy}</code>
          <CopyButton text={notice.copy} />
        </div>
      )}
    </div>
  );
}
