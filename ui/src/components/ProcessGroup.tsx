import { useEffect, useState } from "react";
import type { ChatItem } from "@pi-outpost/shared";
import { ToolCard } from "./ToolCard";
import { AssistantMessage } from "./AssistantMessage";
import { CustomMessageCard } from "./CustomMessageCard";
import type { ActionDispatch } from "../presentations/types";

export function isProcessItem(item: ChatItem): boolean {
  return item.kind === "tool" || (item.kind === "custom" && item.customType === "subagent-notification") || (item.kind === "assistant" && !item.errorMessage &&
    item.blocks.every((block) => block.type === "thinking"));
}

export function ProcessGroup({ entries, showTools, showReasoning, dispatch, highlightedIndex }: {
  entries: { item: ChatItem; index: number }[];
  showTools: boolean;
  showReasoning: boolean;
  dispatch: ActionDispatch;
  highlightedIndex: number | null;
}) {
  const [open, setOpen] = useState(false);
  const highlighted = highlightedIndex !== null && entries.some(({ index }) => index === highlightedIndex);
  useEffect(() => { if (highlighted) setOpen(true); }, [highlightedIndex, highlighted]);
  const visible = entries.filter(({ item }) => item.kind === "tool" ? showTools : item.kind === "custom" || showReasoning && item.kind === "assistant" && item.blocks.length > 0);
  if (!visible.length) return <>{entries.filter(({ item }) => item.kind !== "tool").map(({ index }) => <div key={index} data-item-index={index} className="sr-only" aria-hidden />)}</>;
  const running = visible.some(({ item }) => item.kind === "tool" && item.running);
  const errors = visible.some(({ item }) => item.kind === "tool" && item.isError);
  const tools = visible.filter(({ item }) => item.kind === "tool").length;
  const thoughts = visible.filter(({ item }) => item.kind === "assistant").length;
  const notices = visible.filter(({ item }) => item.kind === "custom").length;
  return (
    <div className="max-w-full self-start rounded-xl border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-left text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-amber-400" : errors ? "bg-red-500" : "bg-emerald-500"}`} />
        <span>Process · {tools} tools{thoughts ? ` · ${thoughts} thinking` : ""}{notices ? ` · ${notices} notification` : ""}{running ? " · running" : ""}</span>
      </button>
      <div className={open ? "flex flex-col gap-1.5 border-t border-zinc-200 p-2 dark:border-zinc-800" : undefined}>
        {entries.filter(({ item }) => item.kind !== "tool" || showTools).map(({ item, index }) => {
          const shown = open && visible.some((entry) => entry.index === index);
          return <div key={item.kind === "tool" ? item.toolCallId : index} data-item-index={index}
            aria-hidden={shown ? undefined : true}
            className={shown ? (highlightedIndex === index ? "rounded-xl ring-2 ring-blue-400" : undefined) : "sr-only"}>
            {shown && (item.kind === "tool" ? <ToolCard item={item} dispatch={dispatch} /> : item.kind === "assistant" ? <AssistantMessage item={item} /> : item.kind === "custom" ? <CustomMessageCard item={item} /> : null)}
          </div>;
        })}
      </div>
    </div>
  );
}
