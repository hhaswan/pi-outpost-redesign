import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ChatItem } from "@pi-outpost/shared";
import { normalizeMathDelimiters } from "../util/markdownMath";
import { RenderedHtml } from "./RenderedHtml";

type CustomItem = Extract<ChatItem, { kind: "custom" }>;

/**
 * Extension-defined message (pi.sendMessage() with a customType). When the
 * extension registered a MessageRenderer, we re-invoke it server-side (same as
 * pi's export-html does for tools) and show the ANSI→HTML output. Otherwise we
 * mirror pi's TUI default: violet card + markdown on `content`.
 */
export function CustomMessageCard({ item }: { item: CustomItem }) {
  const [open, setOpen] = useState(false);
  if (item.customType === "subagent-notification") {
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(item.text)?.[1]?.trim() || "Subagent notification";
    return <div className="max-w-full rounded-xl border border-violet-200 bg-violet-50 text-xs dark:border-violet-900/60 dark:bg-violet-950/30">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex max-w-full items-center gap-2 px-3 py-1.5 text-left text-violet-700 focus-visible:outline-2 focus-visible:outline-violet-500 dark:text-violet-300">
        <span aria-hidden="true">{open ? "▾" : "▸"}</span><span className="truncate">{summary.slice(0, 240)}</span>
      </button>
      {open && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-violet-200 p-3 text-xs dark:border-violet-900/60">{item.text}</pre>}
    </div>;
  }
  const hasDetails = item.details !== undefined;
  const hasRendererHtml = Boolean(item.contentHtml);
  const previewHtml = item.contentHtmlCollapsed ?? item.contentHtml;
  const showExpand = hasDetails || (hasRendererHtml && Boolean(item.contentHtmlCollapsed));

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-900/60 dark:bg-violet-950/30">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-violet-700 dark:text-violet-300">[{item.customType}]</span>
        {showExpand && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            title="Show details"
            className="ml-auto text-xs text-violet-500 hover:text-violet-700 dark:text-violet-500 dark:hover:text-violet-300"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      {hasRendererHtml && previewHtml ? (
        <RenderedHtml
          html={open || !item.contentHtmlCollapsed ? (item.contentHtml ?? previewHtml) : previewHtml}
          className="mt-1 text-violet-950 dark:text-violet-100"
        />
      ) : (
        <div className="prose-chat mt-1 text-violet-950 dark:text-violet-100">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeMathDelimiters(item.text)}
          </ReactMarkdown>
        </div>
      )}
      {open && hasDetails && (
        <pre className="mt-2 max-h-96 overflow-auto border-t border-violet-200 pt-2 font-mono text-xs text-violet-600 dark:border-violet-900/60 dark:text-violet-400">
          {JSON.stringify(item.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
