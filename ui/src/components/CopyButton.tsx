import { useState } from "react";
import { copyText } from "../presentations/copyText";
import { TOUCH_TARGET } from "../touch";

/**
 * Copies `text`. `iconOnly` draws a small glyph for a corner — a code block's — with
 * its purpose in the accessible name rather than on the face.
 */
export function CopyButton({ text, className, iconOnly = false }: { text: string; className?: string; iconOnly?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copied = state === "copied";

  async function handleCopy() {
    // Plain-HTTP deployments have no navigator.clipboard; copyText falls back to execCommand.
    setState((await copyText(text)) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : state === "failed" ? "Copy failed — select the text manually" : iconOnly ? "Copy code" : "Copy"}
      aria-label={iconOnly ? (copied ? "Copied" : state === "failed" ? "Copy failed" : "Copy code") : undefined}
      // The hit area grows on touch screens, whatever face the caller gave it.
      className={`${
        className ??
        "rounded-full px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 hover:opacity-80 transition-opacity"
      } ${TOUCH_TARGET}`}
    >
      {iconOnly ? (copied ? "✓" : state === "failed" ? "✕" : "⧉") : copied ? "✓ copied" : state === "failed" ? "✕ failed" : "⧉ copy"}
    </button>
  );
}
