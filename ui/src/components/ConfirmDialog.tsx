import { useEffect, useId, useRef } from "react";
import type { WireImage } from "@pi-outpost/shared";

/** An action that leaves or rewrites the conversation on screen, waiting for a yes. */
export type ConversationConfirm =
  | { kind: "new" }
  | { kind: "switch"; path: string }
  | { kind: "fork"; entryId: string }
  | { kind: "navigate"; entryId: string }
  | { kind: "edit"; entryId: string; text: string; images?: WireImage[] }
  | { kind: "compact" };

export const NEW_CHAT_BUSY_TEXT = "The agent is still working. It keeps running in its own session; this tab starts a new chat.";
export const NEW_CHAT_IDLE_TEXT = "Start a new chat? The current conversation stays in Sessions.";
export const SWITCH_TEXT = "Open this conversation? The current one stays in Sessions.";
export const SWITCH_BUSY_TEXT = "The agent is still working; it keeps running in its own session.";
export const FORK_TEXT = "Fork from this point? A new conversation starts from here; the current one stays in Sessions.";
export const NAVIGATE_TEXT = "Go back to this point? Later messages stay in the tree.";
export const EDIT_TEXT = "Resend this edited prompt? Messages after it move to a branch.";
export const COMPACT_TEXT = "Compact this conversation? Older messages are summarized to free context; the full history stays in the session file.";

/** What the dialog says for an action; `busy` is read live, so the text follows the agent. */
export function confirmCopy(action: ConversationConfirm, busy: boolean): { title: string; text: string; confirmLabel: string } {
  switch (action.kind) {
    case "new":
      return { title: "New chat", text: busy ? NEW_CHAT_BUSY_TEXT : NEW_CHAT_IDLE_TEXT, confirmLabel: "Start new chat" };
    case "switch":
      return { title: "Open conversation", text: busy ? `${SWITCH_TEXT} ${SWITCH_BUSY_TEXT}` : SWITCH_TEXT, confirmLabel: "Open" };
    case "fork":
      return { title: "Fork conversation", text: FORK_TEXT, confirmLabel: "Fork" };
    case "navigate":
      return { title: "Go back", text: NAVIGATE_TEXT, confirmLabel: "Go back" };
    case "edit":
      return { title: "Resend prompt", text: EDIT_TEXT, confirmLabel: "Resend" };
    case "compact":
      return { title: "Compact conversation", text: COMPACT_TEXT, confirmLabel: "Compact" };
  }
}

/**
 * One question before an action that leaves or rewrites the conversation on screen.
 * Cancel has the focus, so a stray Enter keeps the conversation; Escape and a click on
 * the backdrop cancel too.
 */
export function ConfirmDialog({ title, text, confirmLabel, touch, onConfirm, onCancel }: {
  title: string;
  text: string;
  confirmLabel: string;
  touch: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const textId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Read through a ref: the parent re-renders on every streamed delta, and re-running
  // the effect would pull the focus back to Cancel each time.
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  // The second click of a double click on the control that opened the dialog lands on
  // the backdrop: it must not take the question away before it can be read.
  const openedAt = useRef(Date.now());
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Captured on window: Escape here belongs to this dialog, not to a sheet under it.
      event.preventDefault();
      event.stopPropagation();
      cancel.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  const button = `${touch ? "min-h-11" : "min-h-9"} rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`;
  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && Date.now() - openedAt.current > 500) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 id={titleId} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        <p id={textId} className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {text}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={`${button} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`}
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={`${button} bg-emerald-600 text-white hover:bg-emerald-500`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
