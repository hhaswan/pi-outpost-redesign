import { useEffect, useRef, useState } from "react";
import type { ConfinementVerdict, ContextUsage, ModelChoice, SandboxGrantSet, ThinkingLevel } from "@pi-outpost/shared";
import { ConfinementLock } from "./ConfinementLock";
import { ModelPicker } from "./ModelPicker";
import { THINKING_LEVELS } from "@pi-outpost/shared";
import { formatCost, formatTokens, type SessionUsage } from "../util/sessionUsage";
import { eventHitsNode } from "../util/clickOutside";

interface ModelBarProps {
  model: string;
  models: ModelChoice[];
  thinkingLevel: string;
  /** The levels the current model accepts, in order; absent means offer the full set. */
  thinkingLevels?: ThinkingLevel[];
  modelSupportsReasoning: boolean;
  isStreaming: boolean;
  contextUsage: ContextUsage | null;
  /** The agent's shell's confinement, as observed: absent when it has no runner. */
  shellConfinement?: ConfinementVerdict;
  /** The session's grants beyond the shell's sandbox, shown on its lock. */
  shellGrants?: SandboxGrantSet;
  /** Billed totals for the session so far; absent turns simply do not count. */
  sessionUsage: SessionUsage;
  /**
   * True while the session analysis drawer is open. Optional, with
   * `onToggleAnalysis`, so an embedding host that renders the bar without an
   * analysis panel keeps a plain, non-clickable indicator.
   */
  analysisOpen?: boolean;
  onToggleAnalysis?: () => void;
  isCompacting: boolean;
  onSetModel: (provider: string, id: string) => void;
  onSetThinking: (level: ThinkingLevel) => void;
  onCompact: () => void;
}

function ringColor(usage: ContextUsage | null): string {
  if (!usage || usage.percent === null) return "text-zinc-400 dark:text-zinc-600";
  if (usage.percent >= 85) return "text-red-500";
  if (usage.percent >= 60) return "text-amber-500 dark:text-amber-400";
  return "text-emerald-500";
}

/**
 * What the session has consumed. Tokens lead: they are reported on every
 * deployment, whereas a self-hosted or gateway-fronted model prices nothing, and
 * a cost-first indicator would show an empty slot on exactly those setups.
 *
 * Cost is appended only once some turn carried one, and unpriced turns are named
 * beside it — an amount covering 5 of 7 turns must not read as the whole bill.
 *
 * The figure is also the way in: clicking it opens the breakdown behind it.
 */
function UsageIndicator({
  usage,
  analysisOpen,
  onToggleAnalysis,
}: {
  usage: SessionUsage;
  analysisOpen?: boolean;
  onToggleAnalysis?: () => void;
}) {
  if (usage.turns === 0) return null;

  const priced = usage.turns - usage.unpriced;
  const breakdown = [
    `${usage.turns} turn${usage.turns === 1 ? "" : "s"}`,
    `input ${usage.input.toLocaleString()}`,
    `output ${usage.output.toLocaleString()}`,
    `cache read ${usage.cacheRead.toLocaleString()}`,
    `cache write ${usage.cacheWrite.toLocaleString()}`,
    ...(usage.unpriced > 0 && priced > 0 ? [`${usage.unpriced} unpriced`] : []),
  ].join(" · ");

  // One figure in the bar: the cost once a turn carried one, else the tokens. The rest is
  // in the tooltip and behind the click.
  const figures =
    priced > 0 ? (
      <span>
        {formatCost(usage.cost)}
        {usage.unpriced > 0 && "*"}
      </span>
    ) : (
      <span>{formatTokens(usage.totalTokens)} tok</span>
    );
  const base = "flex min-h-11 min-w-0 max-w-full flex-wrap items-center max-md:shrink-0 max-md:flex-nowrap max-md:whitespace-nowrap gap-1.5 rounded-full border px-2 py-1 font-mono text-xs text-zinc-500 dark:text-zinc-400 hover:opacity-80 transition-opacity sm:min-h-0 [@media(pointer:coarse)]:sm:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900";

  if (!onToggleAnalysis) {
    return (
      <span title={breakdown} className={`${base} border-zinc-300 dark:border-zinc-800`}>
        {figures}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggleAnalysis}
      title={`${breakdown} — click for the session analysis`}
      aria-haspopup="dialog"
      aria-expanded={analysisOpen ?? false}
      className={`${base} ${
        analysisOpen
          ? "border-zinc-400 dark:border-zinc-600"
          : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      {figures}
    </button>
  );
}

/** Radial progress ring: fills clockwise as context usage grows. */
function ContextRing({ usage }: { usage: ContextUsage | null }) {
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;
  const percent = usage?.percent ?? 0;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  return (
    <svg width={18} height={18} viewBox="0 0 36 36" className="-rotate-90 shrink-0">
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        className="text-zinc-200 dark:text-zinc-800"
      />
      {usage && usage.percent !== null && (
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          className={ringColor(usage)}
        />
      )}
    </svg>
  );
}

/**
 * 🧠 button showing the current level; clicking opens a popover with a slider.
 * The slider's stops are the levels the current model accepts — every stop is a
 * level `onSetThinking` will keep, so a selection never snaps back. A model whose
 * accepted set has a gap (`low, medium, xhigh`, no `high`) is presented as three
 * ordered stops, not a range with a dead position. Absent a list, it offers the
 * full set, which is what it did before it was model-aware.
 *
 * A model that accepts one level only gets a sentence instead of a slider: a range
 * whose single stop cannot move reads as a broken control, not as a statement about
 * the model. And a current level the model does not accept is shown as itself,
 * never quietly redrawn at another stop — the server settles that, and until it
 * does the interface should not pretend it already has.
 */
function ThinkingControl({
  thinkingLevel,
  thinkingLevels,
  isStreaming,
  onSetThinking,
}: Pick<ModelBarProps, "thinkingLevel" | "thinkingLevels" | "isStreaming" | "onSetThinking">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = thinkingLevel !== "off";
  const levels = thinkingLevels && thinkingLevels.length > 0 ? thinkingLevels : THINKING_LEVELS;
  const stop = levels.indexOf(thinkingLevel as ThinkingLevel);
  const adjustable = levels.length > 1;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (ref.current && !eventHitsNode(event, ref.current)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isStreaming}
        title="thinking level"
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex min-h-11 items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-xs max-md:min-w-11 max-md:justify-center disabled:opacity-50 hover:opacity-80 transition-opacity sm:min-h-0 [@media(pointer:coarse)]:sm:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 ${
          active
            ? "border-amber-300 text-amber-700 hover:border-amber-400 dark:border-amber-900 dark:text-amber-400 dark:hover:border-amber-700"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
        }`}
      >
        <span aria-hidden className={`text-sm leading-none ${active ? "" : "opacity-40 grayscale"}`}>🧠</span>
        <span className="max-md:sr-only">{thinkingLevel}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-48 max-md:left-auto max-md:right-0 rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">thinking</span>
            <span className="font-mono text-zinc-700 dark:text-zinc-200">{thinkingLevel}</span>
          </div>
          {adjustable ? (
            <>
              <input
                type="range"
                min={0}
                max={levels.length - 1}
                step={1}
                value={stop === -1 ? 0 : stop}
                onChange={(e) => onSetThinking(levels[Number(e.target.value)])}
                aria-label="Thinking level"
                aria-valuetext={thinkingLevel}
                className="w-full accent-amber-500"
              />
              <div className="mt-0.5 flex justify-between font-mono text-[9px] text-zinc-400 dark:text-zinc-600">
                <span>{levels[0]}</span>
                <span>{levels[levels.length - 1]}</span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              this model accepts <span className="font-mono">{levels[0]}</span> only
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ModelBar(props: ModelBarProps) {
  const { model, models, thinkingLevel, modelSupportsReasoning, isStreaming, contextUsage, sessionUsage, isCompacting } =
    props;

  return (
    // On a phone the bar is one row: the model chip takes the room left and truncates,
    // and the other controls shrink to their glyphs (their words stay for screen readers).
    <div data-testid="model-bar" className="mt-1.5 flex min-w-0 flex-nowrap items-center gap-1.5 md:[@media(max-height:900px)]:mt-1">
      <ModelPicker model={model} models={models} disabled={isStreaming} onSetModel={props.onSetModel} />

      {modelSupportsReasoning && (
        <ThinkingControl
          thinkingLevel={thinkingLevel}
          thinkingLevels={props.thinkingLevels}
          isStreaming={isStreaming}
          onSetThinking={props.onSetThinking}
        />
      )}

      {props.shellConfinement && (
        // The lock alone: its words are for screen readers, the details in its tooltip.
        <span className="ml-auto shrink-0 [&>span]:inline-flex [&>span]:h-7 [&>span]:min-w-7 [&>span]:items-center [&>span]:justify-center [&>span]:rounded-full max-md:[&>span]:h-11 max-md:[&>span]:min-w-11 [@media(pointer:coarse)]:[&>span]:h-11 [@media(pointer:coarse)]:[&>span]:min-w-11">
          <ConfinementLock verdict={props.shellConfinement} surface="shell" grants={props.shellGrants} textClassName="sr-only" />
        </span>
      )}

      <button
        type="button"
        onClick={props.onCompact}
        disabled={isStreaming || isCompacting}
        title={
          contextUsage?.tokens != null
            ? `${contextUsage.tokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens — click to compact`
            : "Click to compact the conversation context"
        }
        className={`${props.shellConfinement ? "" : "ml-auto "}flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border max-md:min-w-11 max-md:justify-center border-zinc-300 px-2 py-1 font-mono text-xs text-zinc-500 hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 hover:opacity-80 transition-opacity sm:min-h-0 [@media(pointer:coarse)]:sm:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900`}
      >
        <ContextRing usage={contextUsage} />
        <span className="max-md:sr-only">
          {isCompacting ? "compacting…" : contextUsage?.percent != null ? `${Math.round(contextUsage.percent)}%` : "context"}
        </span>
      </button>
      <UsageIndicator
        usage={sessionUsage}
        analysisOpen={props.analysisOpen}
        onToggleAnalysis={props.onToggleAnalysis}
      />
    </div>
  );
}
